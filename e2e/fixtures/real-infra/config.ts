import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

type Environment = Record<string, string | undefined>;

export const realInfraTargetEnvironment = [
  "DAOFLOW_REAL_INFRA_SSH_HOST",
  "DAOFLOW_REAL_INFRA_SSH_PORT",
  "DAOFLOW_REAL_INFRA_SSH_USER",
  "DAOFLOW_REAL_INFRA_SSH_PRIVATE_KEY",
  "DAOFLOW_REAL_INFRA_SSH_HOST_KEY",
  "DAOFLOW_REAL_INFRA_REMOTE_MARKER_PATH",
  "DAOFLOW_REAL_INFRA_REMOTE_MARKER_NONCE",
  "DAOFLOW_REAL_INFRA_S3_ENDPOINT",
  "DAOFLOW_REAL_INFRA_S3_BUCKET",
  "DAOFLOW_REAL_INFRA_S3_ACCESS_KEY",
  "DAOFLOW_REAL_INFRA_S3_SECRET_ACCESS_KEY",
  "DAOFLOW_REAL_INFRA_S3_REGION"
] as const;

export const realInfraRuntimeEnvironment = [
  "PLAYWRIGHT_REAL_INFRA_DATABASE_URL",
  "REDIS_URL",
  "BETTER_AUTH_SECRET",
  "ENCRYPTION_KEY",
  "TEMPORAL_ADDRESS"
] as const;

export interface RealInfraConfig {
  runToken: string;
  artifactDir: string;
  workspaceRoot: string;
  ssh: {
    host: string;
    port: number;
    user: string;
    privateKey: string;
    hostKey: { algorithm: string; publicKey: string };
    markerPath: string;
    markerNonce: string;
  };
  s3: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretAccessKey: string;
    region: string;
    prefix: string;
  };
  controlPlane: {
    databaseUrl: string;
    redisUrl: string;
    authSecret: string;
    encryptionKey: string;
    temporalAddress: string;
  };
}

export function generateRealInfraRunToken(): string {
  return `ri${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function realInfraDatabaseName(runToken: string): string {
  return `daoflow_real_infra_${runToken}`;
}

export function collectMissingRealInfraEnvironment(env: Environment): string[] {
  const required = [
    "DAOFLOW_REAL_INFRA",
    "DAOFLOW_REAL_INFRA_RUN_TOKEN",
    ...realInfraTargetEnvironment,
    ...realInfraRuntimeEnvironment
  ];
  return required.filter((name) => !env[name]?.trim());
}

export function loadRealInfraConfig(env: Environment = process.env): RealInfraConfig {
  if (env.DAOFLOW_REAL_INFRA !== "1") {
    throw new Error(
      "DAOFLOW_REAL_INFRA must be exactly 1 before the real-infrastructure harness runs."
    );
  }
  const missing = collectMissingRealInfraEnvironment(env);
  if (missing.length > 0) {
    throw new Error(`Real-infrastructure configuration is incomplete: ${missing.join(", ")}.`);
  }

  const runToken = required(env, "DAOFLOW_REAL_INFRA_RUN_TOKEN");
  if (!/^ri[a-z0-9]{12,40}$/.test(runToken)) {
    throw new Error("DAOFLOW_REAL_INFRA_RUN_TOKEN must be a generated real-infrastructure token.");
  }

  const port = Number(required(env, "DAOFLOW_REAL_INFRA_SSH_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("DAOFLOW_REAL_INFRA_SSH_PORT must be a valid TCP port.");
  }

  const host = required(env, "DAOFLOW_REAL_INFRA_SSH_HOST");
  const user = required(env, "DAOFLOW_REAL_INFRA_SSH_USER");
  const markerPath = required(env, "DAOFLOW_REAL_INFRA_REMOTE_MARKER_PATH");
  const markerNonce = required(env, "DAOFLOW_REAL_INFRA_REMOTE_MARKER_NONCE");
  if (!isSafeRemoteValue(host) || !isSafeRemoteValue(user) || !isSafeRemotePath(markerPath)) {
    throw new Error("The configured SSH target or marker path is not safe for the harness.");
  }
  if (!/^[A-Za-z0-9._-]{12,200}$/.test(markerNonce)) {
    throw new Error("DAOFLOW_REAL_INFRA_REMOTE_MARKER_NONCE is invalid.");
  }

  const hostKey = parseHostKey(required(env, "DAOFLOW_REAL_INFRA_SSH_HOST_KEY"));
  const databaseUrl = required(env, "PLAYWRIGHT_REAL_INFRA_DATABASE_URL");
  assertDisposableRealInfraDatabase(databaseUrl, runToken);
  return {
    runToken,
    artifactDir: resolve(
      env.DAOFLOW_REAL_INFRA_ARTIFACT_DIR?.trim() || `test-results/real-infra/${runToken}`
    ),
    workspaceRoot: `/tmp/daoflow-real-infra/${runToken}`,
    ssh: {
      host,
      port,
      user,
      privateKey: required(env, "DAOFLOW_REAL_INFRA_SSH_PRIVATE_KEY"),
      hostKey,
      markerPath,
      markerNonce
    },
    s3: {
      endpoint: required(env, "DAOFLOW_REAL_INFRA_S3_ENDPOINT"),
      bucket: required(env, "DAOFLOW_REAL_INFRA_S3_BUCKET"),
      accessKey: required(env, "DAOFLOW_REAL_INFRA_S3_ACCESS_KEY"),
      secretAccessKey: required(env, "DAOFLOW_REAL_INFRA_S3_SECRET_ACCESS_KEY"),
      region: required(env, "DAOFLOW_REAL_INFRA_S3_REGION"),
      prefix: `real-infra/${runToken}`
    },
    controlPlane: {
      databaseUrl,
      redisUrl: required(env, "REDIS_URL"),
      authSecret: required(env, "BETTER_AUTH_SECRET"),
      encryptionKey: required(env, "ENCRYPTION_KEY"),
      temporalAddress: required(env, "TEMPORAL_ADDRESS")
    }
  };
}

function assertDisposableRealInfraDatabase(databaseUrl: string, runToken: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("PLAYWRIGHT_REAL_INFRA_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !localHosts.has(parsed.hostname) ||
    !parsed.username ||
    !parsed.password ||
    databaseName !== realInfraDatabaseName(runToken)
  ) {
    throw new Error(
      `PLAYWRIGHT_REAL_INFRA_DATABASE_URL must target the local disposable database ${realInfraDatabaseName(runToken)}.`
    );
  }
}

export function realInfraConfigSummary(config: RealInfraConfig) {
  return {
    enabled: true,
    runToken: config.runToken,
    targetConfigured: true,
    s3Configured: true,
    controlPlaneConfigured: true,
    workspaceRoot: config.workspaceRoot
  };
}

export function sensitiveConfigValues(config: RealInfraConfig) {
  return [
    config.ssh.host,
    config.ssh.user,
    config.ssh.privateKey,
    config.ssh.hostKey.algorithm,
    config.ssh.hostKey.publicKey,
    config.ssh.markerPath,
    config.ssh.markerNonce,
    config.s3.endpoint,
    config.s3.bucket,
    config.s3.accessKey,
    config.s3.secretAccessKey,
    config.controlPlane.databaseUrl,
    config.controlPlane.redisUrl,
    config.controlPlane.authSecret,
    config.controlPlane.encryptionKey,
    config.controlPlane.temporalAddress
  ];
}

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required real-infrastructure setting: ${name}.`);
  return value;
}

function parseHostKey(value: string) {
  const parts = value.split(/\s+/);
  if (
    parts.length !== 2 ||
    !/^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521))$/.test(parts[0] ?? "") ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1] ?? "")
  ) {
    throw new Error("DAOFLOW_REAL_INFRA_SSH_HOST_KEY must contain one exact SSH public host key.");
  }
  return { algorithm: parts[0]!, publicKey: parts[1]! };
}

function isSafeRemoteValue(value: string): boolean {
  return value.length <= 255 && !/[\s\u0000\r\n]/.test(value);
}

function isSafeRemotePath(value: string): boolean {
  return (
    value.startsWith("/") &&
    value.length <= 4_096 &&
    !/[\u0000\r\n]/.test(value) &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}
