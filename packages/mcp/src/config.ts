/**
 * Connection configuration for the DaoFlow MCP server.
 *
 * Resolution order (matches the CLI so a logged-in `daoflow` session works out of the box):
 *   1. DAOFLOW_URL + DAOFLOW_TOKEN environment variables (both required together)
 *   2. The current context in ~/.daoflow/config.json written by `daoflow login`
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaoFlowConnection {
  apiUrl: string;
  token: string;
}

interface StoredContext {
  apiUrl: string;
  token: string;
}

interface StoredConfig {
  currentContext: string;
  contexts: Record<string, StoredContext>;
}

function configFilePath(): string {
  return join(homedir(), ".daoflow", "config.json");
}

function fromEnvironment(): DaoFlowConnection | null {
  const apiUrl = process.env.DAOFLOW_URL;
  const token = process.env.DAOFLOW_TOKEN;
  if (!apiUrl && !token) {
    return null;
  }

  if (!apiUrl || !token) {
    throw new Error(
      "DAOFLOW_URL and DAOFLOW_TOKEN must both be set when using environment-based MCP auth."
    );
  }

  return { apiUrl: apiUrl.replace(/\/$/, ""), token };
}

function fromConfigFile(): DaoFlowConnection | null {
  const path = configFilePath();
  if (!existsSync(path)) {
    return null;
  }

  const config = JSON.parse(readFileSync(path, "utf-8")) as StoredConfig;
  const context = config.contexts?.[config.currentContext];
  if (!context?.apiUrl || !context?.token) {
    return null;
  }

  return { apiUrl: context.apiUrl.replace(/\/$/, ""), token: context.token };
}

/**
 * Resolve the active DaoFlow connection, or throw a clear, agent-readable error
 * when no credentials are configured.
 */
export function resolveConnection(): DaoFlowConnection {
  const connection = fromEnvironment() ?? fromConfigFile();
  if (!connection) {
    throw new Error(
      "No DaoFlow credentials found. Set DAOFLOW_URL and DAOFLOW_TOKEN, or run `daoflow login` to create ~/.daoflow/config.json."
    );
  }

  return connection;
}
