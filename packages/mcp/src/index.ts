#!/usr/bin/env bun
/**
 * Entry point for the DaoFlow MCP server (stdio transport).
 *
 * Configure via DAOFLOW_URL + DAOFLOW_TOKEN, or a `daoflow login` session in
 * ~/.daoflow/config.json. Credentials are resolved lazily, so the tool list is
 * advertised even before auth is configured.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClientGetter } from "./client";
import { createMcpServer } from "./server";

async function main(): Promise<void> {
  const server = createMcpServer(createClientGetter());
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the MCP protocol; logs go to stderr.
  console.error("DaoFlow MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting DaoFlow MCP server:", error);
  process.exit(1);
});
