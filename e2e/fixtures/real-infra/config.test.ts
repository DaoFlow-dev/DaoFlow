import { describe, expect, test } from "bun:test";
import {
  collectMissingRealInfraEnvironment,
  generateRealInfraRunToken,
  loadRealInfraConfig,
  realInfraDatabaseName,
  realInfraRuntimeEnvironment,
  realInfraTargetEnvironment
} from "./config";

function configuredEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    DAOFLOW_REAL_INFRA: "1",
    DAOFLOW_REAL_INFRA_RUN_TOKEN: "ri0123456789abcdef",
    DAOFLOW_REAL_INFRA_SSH_PORT: "22",
    DAOFLOW_REAL_INFRA_REMOTE_MARKER_PATH: "/tmp/marker",
    DAOFLOW_REAL_INFRA_SSH_HOST_KEY: ["ssh-ed25519", Buffer.from("test").toString("base64")].join(
      " "
    )
  };

  for (const name of [...realInfraTargetEnvironment, ...realInfraRuntimeEnvironment]) {
    env[name] ??= `test-${name.toLowerCase()}`;
  }
  env.PLAYWRIGHT_REAL_INFRA_DATABASE_URL = `postgresql://realinfra:password@127.0.0.1:5432/${realInfraDatabaseName(env.DAOFLOW_REAL_INFRA_RUN_TOKEN)}`;
  return env;
}

describe("real infrastructure configuration", () => {
  test("collects every missing setting without exposing values", () => {
    const missing = collectMissingRealInfraEnvironment({ DAOFLOW_REAL_INFRA: "1" });

    expect(missing).toContain("DAOFLOW_REAL_INFRA_SSH_PRIVATE_KEY");
    expect(missing).toContain("DAOFLOW_REAL_INFRA_S3_SECRET_ACCESS_KEY");
    expect(missing).toContain("PLAYWRIGHT_REAL_INFRA_DATABASE_URL");
  });

  test("derives only owned paths and prefixes from the run token", () => {
    const config = loadRealInfraConfig(configuredEnvironment());

    expect(config.s3.prefix).toBe(`real-infra/${config.runToken}`);
    expect(config.workspaceRoot).toEndWith(config.runToken);
    expect(config.artifactDir).toContain(config.runToken);
  });

  test("generates a valid unique run token", () => {
    const first = generateRealInfraRunToken();
    const second = generateRealInfraRunToken();

    expect(first).toMatch(/^ri[a-z0-9]{20}$/);
    expect(first).not.toBe(second);
  });

  test("rejects a control-plane database that is not local and token-scoped", () => {
    const env = configuredEnvironment();
    env.PLAYWRIGHT_REAL_INFRA_DATABASE_URL =
      "postgresql://owner:secret@db.example.com:5432/production";

    expect(() => loadRealInfraConfig(env)).toThrow("local disposable database");
  });
});
