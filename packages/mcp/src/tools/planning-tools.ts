/**
 * Planning-lane MCP tools: generate plans and previews without mutating state.
 *
 * These let an agent reason about an action — and present it to a human — before
 * any command-lane tool is invoked.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DaoFlowMcpClient } from "../trpc-contract";
import { runCall } from "../tool-helpers";

const readOnly = { readOnlyHint: true } as const;

export function registerPlanningTools(server: McpServer, getClient: () => DaoFlowMcpClient): void {
  server.registerTool(
    "daoflow_deployment_plan",
    {
      title: "Deployment plan",
      description:
        "Preview a deployment for a service (no execution): resolved target, image, and steps.",
      inputSchema: {
        service: z.string().min(1),
        server: z.string().min(1).optional(),
        image: z.string().min(1).optional()
      },
      annotations: readOnly
    },
    ({ service, server: targetServer, image }) =>
      runCall(() => getClient().deploymentPlan.query({ service, server: targetServer, image }))
  );

  server.registerTool(
    "daoflow_rollback_plan",
    {
      title: "Rollback plan",
      description:
        "Preview a rollback for a service to a known previous deployment (no execution).",
      inputSchema: {
        service: z.string().min(1),
        target: z.string().min(1).optional()
      },
      annotations: readOnly
    },
    ({ service, target }) => runCall(() => getClient().rollbackPlan.query({ service, target }))
  );

  server.registerTool(
    "daoflow_backup_restore_plan",
    {
      title: "Backup restore plan",
      description: "Preview restoring a specific backup run (no execution).",
      inputSchema: { backupRunId: z.string().min(1) },
      annotations: readOnly
    },
    ({ backupRunId }) => runCall(() => getClient().backupRestorePlan.query({ backupRunId }))
  );
}
