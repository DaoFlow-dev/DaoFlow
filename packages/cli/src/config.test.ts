import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfigFilePath,
  getConfigFileMode,
  getCurrentContext,
  loadConfig,
  saveConfig,
  setContext,
  type DaoFlowConfig
} from "./config";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;

describe("CLI auth config", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-cli-home-"));
    process.env.HOME = homeDir;
    delete process.env.DAOFLOW_URL;
    delete process.env.DAOFLOW_TOKEN;
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (originalUrl) {
      process.env.DAOFLOW_URL = originalUrl;
    } else {
      delete process.env.DAOFLOW_URL;
    }

    if (originalToken) {
      process.env.DAOFLOW_TOKEN = originalToken;
    } else {
      delete process.env.DAOFLOW_TOKEN;
    }

    rmSync(homeDir, { recursive: true, force: true });
  });

  test("setContext persists auth metadata and locks config file permissions", () => {
    setContext("default", {
      apiUrl: "https://deploy.example.com",
      token: "dfl_token_123"
    });

    const config = loadConfig();
    expect(config.currentContext).toBe("default");
    expect(config.contexts.default).toEqual({
      apiUrl: "https://deploy.example.com",
      token: "dfl_token_123",
      authMethod: "api-token"
    });
    expect(getConfigFileMode()).toBe(0o600);
  });

  test("loadConfig backfills authMethod for older saved contexts", () => {
    const configPath = getConfigFilePath();
    saveConfig({
      currentContext: "legacy",
      contexts: {
        legacy: {
          apiUrl: "https://deploy.example.com",
          token: "session_token_123"
        }
      }
    } satisfies DaoFlowConfig);

    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as DaoFlowConfig;
    delete parsed.contexts.legacy?.authMethod;
    chmodSync(configPath, 0o644);
    writeFileSync(configPath, JSON.stringify(parsed, null, 2));

    const loaded = loadConfig();
    expect(loaded.contexts.legacy?.authMethod).toBe("session");
    expect(getConfigFileMode()).toBe(0o644);
  });

  test("getCurrentContext prefers documented env vars over stored config", () => {
    setContext("default", {
      apiUrl: "https://stored.example.com",
      token: "session_token_123"
    });

    process.env.DAOFLOW_URL = "https://env.example.com/";
    process.env.DAOFLOW_TOKEN = "dfl_env_token";

    expect(getCurrentContext()).toEqual({
      apiUrl: "https://env.example.com",
      token: "dfl_env_token",
      authMethod: "api-token"
    });
  });
});
