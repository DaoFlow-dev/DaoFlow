/**
 * Assemble the DaoFlow MCP server and register its tool surface.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DaoFlowMcpClient } from "./trpc-contract";
import { registerReadTools } from "./tools/read-tools";
import { registerPlanningTools } from "./tools/planning-tools";
import { registerCommandTools } from "./tools/command-tools";

export const SERVER_NAME = "daoflow";
export const SERVER_VERSION = "0.11.0";

const INSTRUCTIONS = [
  "DaoFlow is an agent-first, human-supervised platform for hosting Docker and Docker Compose",
  "workloads. Tools are grouped into three lanes:",
  "- read: observe servers, projects, services, deployments, logs, events, audit, backups.",
  "- planning: preview deploys, rollbacks, and restores without executing them.",
  "- command: mutating actions. Each requires confirm:true and the API token must hold the",
  "  matching scope (the server enforces scopes regardless of confirm).",
  "Recommended loop: read to understand state -> plan the change -> show the plan -> only then",
  "call a command tool with confirm:true. High-risk actions (restore) may require human approval."
].join(" ");

export function createMcpServer(getClient: () => DaoFlowMcpClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS }
  );

  registerReadTools(server, getClient);
  registerPlanningTools(server, getClient);
  registerCommandTools(server, getClient);

  return server;
}
