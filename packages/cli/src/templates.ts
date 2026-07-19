import { randomBytes } from "crypto";
import embeddedCompose from "../../../docker-compose.yml" with { type: "text" };
import {
  getInstallWorkflowProfileEnv,
  type InstallWorkflowProfile
} from "./install-workflow-profile";

const embeddedComposeTemplate = String(embeddedCompose);
const SAFE_ENV_VALUE = /^[A-Za-z0-9_./:@+-]*$/;

const COMPOSE_RAW_BASE_URL = "https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow";
const SEMVER_RELEASE =
  /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/;

function composeRefForVersion(version?: string): string {
  const target = version?.trim();
  if (!target || target === "latest") {
    return "main";
  }

  const releaseMatch = target.match(SEMVER_RELEASE);
  if (releaseMatch) {
    return `v${releaseMatch[1]}`;
  }

  return "main";
}

function composeRawUrl(version?: string): string {
  return `${COMPOSE_RAW_BASE_URL}/${composeRefForVersion(version)}/docker-compose.yml`;
}

/**
 * Fetch the production docker-compose.yml.
 *
 * Strategy:
 *   1. Download from GitHub raw for the requested release version
 *   2. Fall back to build-time embedded copy (works offline)
 *   3. If both fail, throw with clear error message
 */
export async function fetchComposeYml(version?: string): Promise<string> {
  const rawUrl = composeRawUrl(version);

  // Try downloading from GitHub first
  try {
    const response = await fetch(rawUrl, {
      signal: AbortSignal.timeout(10_000) // 10s timeout
    });
    if (response.ok) {
      const content = await response.text();
      if (content.includes("services:") && content.includes("daoflow")) {
        return content;
      }
    }
  } catch {
    // Network error — fall through to embedded
  }

  // Fall back to embedded copy
  if (embeddedComposeTemplate) {
    return embeddedComposeTemplate;
  }

  throw new Error(
    "Could not fetch docker-compose.yml from GitHub and no embedded copy available.\n" +
      `Try downloading manually: curl -fsSL ${rawUrl} -o docker-compose.yml`
  );
}

/**
 * Generate a cryptographically secure random hex string.
 */
function secureHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function serializeEnvValue(value: string): string {
  if (SAFE_ENV_VALUE.test(value)) {
    return value;
  }

  if (!value.includes("'") && !value.includes("\n") && !value.includes("\r")) {
    return `'${value}'`;
  }

  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "$$$$")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function envLine(key: string, value: string | number | undefined): string {
  return `${key}=${serializeEnvValue(value === undefined ? "" : String(value))}`;
}

function parseDoubleQuotedEnvValue(value: string): string {
  let parsed = "";

  for (let i = 0; i < value.length; i++) {
    const current = value[i];
    const next = value[i + 1];

    if (current === "$" && next === "$") {
      parsed += "$";
      i++;
      continue;
    }

    if (current === "\\" && next) {
      if (next === "n") parsed += "\n";
      else if (next === "r") parsed += "\r";
      else if (next === "t") parsed += "\t";
      else if (next === '"') parsed += '"';
      else if (next === "\\") parsed += "\\";
      else parsed += next;
      i++;
      continue;
    }

    parsed += current;
  }

  return parsed;
}

/**
 * Generate the .env file with secure random secrets.
 * Passwords can be provided manually or auto-generated.
 */
export function generateEnvFile(opts: {
  version: string;
  domain: string;
  port: number;
  scheme?: "http" | "https";
  exposureMode?: "none" | "traefik" | "cloudflare-quick" | "tailscale-serve" | "tailscale-funnel";
  cloudflareTunnelEnabled?: boolean;
  cloudflareTunnelToken?: string;
  acmeEmail?: string;
  initialAdminEmail?: string;
  initialAdminPassword?: string;
  postgresPassword?: string;
  temporalPostgresPassword?: string;
  workflowProfile?: InstallWorkflowProfile;
  authSecret?: string;
  encryptionKey?: string;
  recoveryEncryptionKey?: string;
  preservedEnv?: Record<string, string>;
}): string {
  const workflowProfile = opts.workflowProfile ?? "lean";
  const workflowProfileEnv = getInstallWorkflowProfileEnv(workflowProfile);
  const pgPass = opts.postgresPassword ?? secureHex(24);
  const temporalPgPass = opts.temporalPostgresPassword ?? secureHex(24);
  const authSecret = opts.authSecret ?? secureHex(32);
  const encKey = opts.encryptionKey ?? secureHex(16); // 32 hex chars
  const recoveryKey = opts.recoveryEncryptionKey ?? secureHex(32); // 64 hex chars
  const databaseName = opts.preservedEnv?.DAOFLOW_DATABASE_NAME?.trim() || "daoflow";

  const scheme = opts.scheme ?? (opts.domain === "localhost" ? "http" : "https");
  const usesManagedHttpsEdge = opts.exposureMode === "traefik" || opts.cloudflareTunnelEnabled;
  const portSuffix =
    usesManagedHttpsEdge ||
    (scheme === "https" && opts.port === 443) ||
    (scheme === "http" && opts.port === 80)
      ? ""
      : `:${opts.port}`;
  const managedKeys = new Set([
    "DAOFLOW_VERSION",
    "BETTER_AUTH_URL",
    "DAOFLOW_BIND",
    "DAOFLOW_PORT",
    "DAOFLOW_DOMAIN",
    "DAOFLOW_ACME_EMAIL",
    "DAOFLOW_PROXY_NETWORK",
    "CLOUDFLARE_TUNNEL_TOKEN",
    "DAOFLOW_INITIAL_ADMIN_EMAIL",
    "DAOFLOW_INITIAL_ADMIN_PASSWORD",
    "DAOFLOW_DATABASE_NAME",
    "POSTGRES_PASSWORD",
    "TEMPORAL_POSTGRES_PASSWORD",
    "BETTER_AUTH_SECRET",
    "ENCRYPTION_KEY",
    "DAOFLOW_RECOVERY_ENCRYPTION_KEY",
    "DAOFLOW_WORKFLOW_PROFILE",
    "COMPOSE_PROFILES",
    "DAOFLOW_ENABLE_TEMPORAL"
  ]);
  const preservedEntries = Object.entries(opts.preservedEnv ?? {}).filter(
    ([key]) => !managedKeys.has(key)
  );

  return `# DaoFlow configuration -- generated by daoflow install
# After editing this file, apply changes with: docker compose up -d
# NOTE: 'docker compose restart' does NOT re-read .env -- always use 'up -d'.

# -- Version ---------------------------------------------------------------
${envLine("DAOFLOW_VERSION", opts.version)}

# -- Workflow Profile -------------------------------------------------------
# Lean runs DaoFlow, PostgreSQL, and Redis. Temporal adds workflow services.
${envLine("DAOFLOW_WORKFLOW_PROFILE", workflowProfileEnv.DAOFLOW_WORKFLOW_PROFILE)}
${envLine("COMPOSE_PROFILES", workflowProfileEnv.COMPOSE_PROFILES)}

# -- Public URL -------------------------------------------------------------
${envLine("BETTER_AUTH_URL", `${scheme}://${opts.domain}${portSuffix}`)}
${envLine("DAOFLOW_BIND", "127.0.0.1")}
${envLine("DAOFLOW_PORT", opts.port)}
${opts.exposureMode === "traefik" || opts.cloudflareTunnelEnabled ? `${envLine("DAOFLOW_DOMAIN", opts.domain)}\n` : ""}${opts.exposureMode === "traefik" ? `${envLine("DAOFLOW_ACME_EMAIL", opts.acmeEmail ?? opts.initialAdminEmail ?? "")}\n${envLine("DAOFLOW_PROXY_NETWORK", "daoflow-proxy")}\n` : ""}${opts.cloudflareTunnelEnabled ? `${envLine("CLOUDFLARE_TUNNEL_TOKEN", opts.cloudflareTunnelToken ?? "")}\n` : ""}

# -- First-Boot Owner Bootstrap ---------------------------------------------
# Password must be at least 8 characters.
${envLine("DAOFLOW_INITIAL_ADMIN_EMAIL", opts.initialAdminEmail)}
${envLine("DAOFLOW_INITIAL_ADMIN_PASSWORD", opts.initialAdminPassword)}

# -- Database ---------------------------------------------------------------
${envLine("DAOFLOW_DATABASE_NAME", databaseName)}
${envLine("POSTGRES_PASSWORD", pgPass)}

# -- Temporal Database (auto-generated password) ----------------------------
${envLine("TEMPORAL_POSTGRES_PASSWORD", temporalPgPass)}

# -- Secrets (auto-generated, do not share) ---------------------------------
${envLine("BETTER_AUTH_SECRET", authSecret)}
${envLine("ENCRYPTION_KEY", encKey)}

# -- Disaster Recovery (separate external key) ------------------------------
${envLine("DAOFLOW_RECOVERY_ENCRYPTION_KEY", recoveryKey)}
# DAOFLOW_PREVIOUS_RECOVERY_ENCRYPTION_KEY=
# DAOFLOW_RECOVERY_KEY_ROTATED_AT=
# DAOFLOW_CONTROL_PLANE_POSTGRES_CONTAINER=

# -- Deployment Worker ------------------------------------------------------
# DEPLOY_TIMEOUT_MS=600000

# -- Temporal (workflow orchestration) --------------------------------------
${envLine("DAOFLOW_ENABLE_TEMPORAL", workflowProfileEnv.DAOFLOW_ENABLE_TEMPORAL)}
${envLine("TEMPORAL_ADDRESS", "temporal:7233")}
# TEMPORAL_NAMESPACE=daoflow
# TEMPORAL_TASK_QUEUE=daoflow-deployments
# TEMPORAL_UI_PORT=8233

# -- Optional: S3 backup storage -------------------------------------------
# S3_ENDPOINT=https://s3.amazonaws.com
# S3_BUCKET=daoflow-backups
# S3_ACCESS_KEY=
# S3_SECRET_KEY=
# S3_REGION=us-east-1

# -- Optional: SMTP for email notifications --------------------------------
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=
${preservedEntries.length > 0 ? `\n# -- Preserved Existing Settings --------------------------------------------\n${preservedEntries.map(([key, value]) => envLine(key, value)).join("\n")}\n` : ""}`;
}

/**
 * Parse a .env file into a key-value Record.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value =
      rawValue.startsWith("'") && rawValue.endsWith("'")
        ? rawValue.slice(1, -1)
        : rawValue.startsWith('"') && rawValue.endsWith('"')
          ? parseDoubleQuotedEnvValue(rawValue.slice(1, -1))
          : rawValue;
    env[key] = value;
  }
  return env;
}

/**
 * Get the default DaoFlow install directory.
 */
export function defaultInstallDir(): string {
  if (process.platform === "darwin") {
    return `${process.env.HOME}/.daoflow/server`;
  }
  return "/opt/daoflow";
}
