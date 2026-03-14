import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface DaoFlowContext {
  apiUrl: string;
  token: string;
  project?: string;
  environment?: string;
}

export interface DaoFlowConfig {
  currentContext: string;
  contexts: Record<string, DaoFlowContext>;
}

const CONFIG_DIR = join(homedir(), ".daoflow");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): DaoFlowConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return { currentContext: "default", contexts: {} };
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as DaoFlowConfig;
}

export function saveConfig(config: DaoFlowConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getCurrentContext(): DaoFlowContext | null {
  const config = loadConfig();
  return config.contexts[config.currentContext] ?? null;
}

export function setContext(name: string, ctx: DaoFlowContext): void {
  const config = loadConfig();
  config.contexts[name] = ctx;
  config.currentContext = name;
  saveConfig(config);
}
