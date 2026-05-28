/**
 * Command-lane MCP tools: mutating operations.
 *
 * Every tool here requires an explicit `confirm: true` (mirroring the CLI's
 * `--yes`) AND the API token must hold the corresponding scope — the server
 * enforces scopes independently, so an under-scoped token is rejected even if
 * `confirm` is set. High-risk actions (restore) additionally route through the
 * server's approval-gate machinery.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DaoFlowMcpClient } from "../trpc-contract";
import { requireConfirm, runCall } from "../tool-helpers";

const confirm = {
  confirm: z.boolean().optional().describe("Must be true to execute this mutating command.")
};

const destructive = { destructiveHint: true } as const;

export function registerCommandTools(server: McpServer, getClient: () => DaoFlowMcpClient): void {
  server.registerTool(
    "daoflow_trigger_deploy",
    {
      title: "Trigger deploy",
      description:
        "Start a deployment for a service. Requires confirm:true and the deploy:start scope.",
      inputSchema: {
        serviceId: z.string().min(1),
        commitSha: z.string().min(1).optional(),
        imageTag: z.string().min(1).optional(),
        ...confirm
      },
      annotations: destructive
    },
    ({ serviceId, commitSha, imageTag, confirm: confirmed }) => {
      const refusal = requireConfirm(confirmed, "daoflow_trigger_deploy");
      return (
        refusal ??
        runCall(() => getClient().triggerDeploy.mutate({ serviceId, commitSha, imageTag }))
      );
    }
  );

  server.registerTool(
    "daoflow_execute_rollback",
    {
      title: "Execute rollback",
      description:
        "Roll a service back to a specific previous deployment. Requires confirm:true and the deploy:rollback scope.",
      inputSchema: {
        serviceId: z.string().min(1),
        targetDeploymentId: z.string().min(1),
        ...confirm
      },
      annotations: destructive
    },
    ({ serviceId, targetDeploymentId, confirm: confirmed }) => {
      const refusal = requireConfirm(confirmed, "daoflow_execute_rollback");
      return (
        refusal ??
        runCall(() => getClient().executeRollback.mutate({ serviceId, targetDeploymentId }))
      );
    }
  );

  server.registerTool(
    "daoflow_cancel_deployment",
    {
      title: "Cancel deployment",
      description:
        "Cancel an in-progress deployment. Requires confirm:true and the deploy:cancel scope.",
      inputSchema: { deploymentId: z.string().min(1), ...confirm },
      annotations: destructive
    },
    ({ deploymentId, confirm: confirmed }) => {
      const refusal = requireConfirm(confirmed, "daoflow_cancel_deployment");
      return refusal ?? runCall(() => getClient().cancelDeployment.mutate({ deploymentId }));
    }
  );

  server.registerTool(
    "daoflow_trigger_backup",
    {
      title: "Trigger backup",
      description: "Run a backup policy now. Requires confirm:true and the backup:run scope.",
      inputSchema: { policyId: z.string().min(1), ...confirm },
      annotations: destructive
    },
    ({ policyId, confirm: confirmed }) => {
      const refusal = requireConfirm(confirmed, "daoflow_trigger_backup");
      return refusal ?? runCall(() => getClient().triggerBackupNow.mutate({ policyId }));
    }
  );

  server.registerTool(
    "daoflow_queue_backup_restore",
    {
      title: "Queue backup restore",
      description:
        "Queue a restore of a backup run. High-risk: requires confirm:true, the backup:restore scope, and may require an approval before it executes.",
      inputSchema: { backupRunId: z.string().min(1), ...confirm },
      annotations: destructive
    },
    ({ backupRunId, confirm: confirmed }) => {
      const refusal = requireConfirm(confirmed, "daoflow_queue_backup_restore");
      return refusal ?? runCall(() => getClient().queueBackupRestore.mutate({ backupRunId }));
    }
  );

  server.registerTool(
    "daoflow_set_env_var",
    {
      title: "Set environment variable",
      description:
        "Create or update an environment variable (or secret). Requires confirm:true and the env:write (or secrets:write) scope.",
      inputSchema: {
        environmentId: z.string().min(1),
        key: z.string().min(1),
        value: z.string(),
        isSecret: z.boolean().default(false),
        category: z.enum(["runtime", "build"]).default("runtime"),
        ...confirm
      },
      annotations: destructive
    },
    ({ environmentId, key, value, isSecret, category, confirm: confirmed }) => {
      const refusal = requireConfirm(confirmed, "daoflow_set_env_var");
      return (
        refusal ??
        runCall(() =>
          getClient().upsertEnvironmentVariable.mutate({
            environmentId,
            key,
            value,
            isSecret,
            category
          })
        )
      );
    }
  );

  server.registerTool(
    "daoflow_approve_request",
    {
      title: "Approve request",
      description:
        "Approve a pending approval request. Requires confirm:true and the approvals:decide scope. An agent cannot approve its own request (server-enforced).",
      inputSchema: { requestId: z.string().min(1), ...confirm },
      annotations: destructive
    },
    ({ requestId, confirm: confirmed }) => {
      const refusal = requireConfirm(confirmed, "daoflow_approve_request");
      return refusal ?? runCall(() => getClient().approveApprovalRequest.mutate({ requestId }));
    }
  );
}
