import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface DaoFlowContext {
  apiUrl: string;
  token: string;
  authMethod?: "session" | "api-token";
  project?: string;
  environment?: string;
}

export interface DaoFlowConfig {
  currentContext: string;
  contexts: Record<string, DaoFlowContext>;
}

function getConfigDirPath(): string {
  return join(homedir(), ".daoflow");
}

function resolveConfigFilePath(): string {
  return join(getConfigDirPath(), "config.json");
}

export function ensureConfigDir(): void {
  const configDir = getConfigDirPath();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  chmodSync(configDir, 0o700);
}

function normalizeContext(ctx: DaoFlowContext): DaoFlowContext {
  return {
    ...ctx,
    authMethod: ctx.authMethod ?? (ctx.token.startsWith("dfl_") ? "api-token" : "session")
  };
}

function normalizeConfig(config: DaoFlowConfig): DaoFlowConfig {
  return {
    ...config,
    contexts: Object.fromEntries(
      Object.entries(config.contexts).map(([name, ctx]) => [name, normalizeContext(ctx)])
    )
  };
}

export function getConfigFilePath(): string {
  return resolveConfigFilePath();
}

export function getConfigFileMode(): number | null {
  const configFile = resolveConfigFilePath();
  if (!existsSync(configFile)) {
    return null;
  }

  return statSync(configFile).mode & 0o777;
}

export function loadConfig(): DaoFlowConfig {
  ensureConfigDir();
  const configFile = resolveConfigFilePath();
  if (!existsSync(configFile)) {
    return { currentContext: "default", contexts: {} };
  }

  return normalizeConfig(JSON.parse(readFileSync(configFile, "utf-8")) as DaoFlowConfig);
}

export function saveConfig(config: DaoFlowConfig): void {
  ensureConfigDir();
  const configFile = resolveConfigFilePath();
  writeFileSync(configFile, JSON.stringify(normalizeConfig(config), null, 2), { mode: 0o600 });
  chmodSync(configFile, 0o600);
}

export function getCurrentContext(): DaoFlowContext | null {
  const envUrl = process.env.DAOFLOW_URL;
  const envToken = process.env.DAOFLOW_TOKEN;
  if (envUrl || envToken) {
    if (!envUrl || !envToken) {
      throw new Error(
        "DAOFLOW_URL and DAOFLOW_TOKEN must both be set when using environment-based CLI auth."
      );
    }

    return normalizeContext({
      apiUrl: envUrl.replace(/\/$/, ""),
      token: envToken
    });
  }

  const config = loadConfig();
  return config.contexts[config.currentContext] ?? null;
}

export function setContext(name: string, ctx: DaoFlowContext): void {
  const config = loadConfig();
  config.contexts[name] = normalizeContext(ctx);
  config.currentContext = name;
  saveConfig(config);
}
