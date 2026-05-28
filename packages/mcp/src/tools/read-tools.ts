/**
 * Read-lane MCP tools: observe infrastructure without mutating it.
 *
 * Every tool here maps to a tRPC query and is marked read-only. The underlying
 * API token's scopes are the real authority — a tool call against a procedure
 * the token cannot reach returns a structured SCOPE_DENIED error.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DaoFlowMcpClient } from "../trpc-contract";
import { runCall } from "../tool-helpers";

const readOnly = { readOnlyHint: true } as const;
const limit = { limit: z.number().int().positive().max(500).optional() };

export function registerReadTools(server: McpServer, getClient: () => DaoFlowMcpClient): void {
  server.registerTool(
    "daoflow_whoami",
    {
      title: "Whoami",
      description:
        "Return the current principal, role, auth method, and granted capability scopes.",
      annotations: readOnly
    },
    () => runCall(() => getClient().viewer.query())
  );

  server.registerTool(
    "daoflow_server_readiness",
    {
      title: "Server readiness",
      description:
        "List registered servers with SSH/Docker/Compose reachability, versions, latency, and recommended actions.",
      inputSchema: limit,
      annotations: readOnly
    },
    ({ limit }) => runCall(() => getClient().serverReadiness.query({ limit }))
  );

  server.registerTool(
    "daoflow_projects",
    {
      title: "List projects",
      description: "List all projects with their environment counts.",
      inputSchema: limit,
      annotations: readOnly
    },
    ({ limit }) => runCall(() => getClient().projects.query({ limit }))
  );

  server.registerTool(
    "daoflow_project_details",
    {
      title: "Project details",
      description:
        "Return a single project with its environments, services, and git configuration.",
      inputSchema: { projectId: z.string().min(1) },
      annotations: readOnly
    },
    ({ projectId }) => runCall(() => getClient().projectDetails.query({ projectId }))
  );

  server.registerTool(
    "daoflow_services",
    {
      title: "List services",
      description: "List services, optionally filtered to one environment.",
      inputSchema: { environmentId: z.string().min(1).optional(), ...limit },
      annotations: readOnly
    },
    ({ environmentId, limit }) =>
      runCall(() => getClient().services.query({ environmentId, limit }))
  );

  server.registerTool(
    "daoflow_service_details",
    {
      title: "Service details",
      description: "Return a single service with its current runtime state.",
      inputSchema: { serviceId: z.string().min(1) },
      annotations: readOnly
    },
    ({ serviceId }) => runCall(() => getClient().serviceDetails.query({ serviceId }))
  );

  server.registerTool(
    "daoflow_deployment_details",
    {
      title: "Deployment details",
      description:
        "Return a deployment record with steps, health summary, and recovery guidance — the agent-ready failure context for diagnosis.",
      inputSchema: { deploymentId: z.string().min(1) },
      annotations: readOnly
    },
    ({ deploymentId }) => runCall(() => getClient().deploymentDetails.query({ deploymentId }))
  );

  server.registerTool(
    "daoflow_deployment_logs",
    {
      title: "Deployment logs",
      description:
        "Fetch structured deployment/service logs, optionally filtered by deployment, service, keyword, or stream.",
      inputSchema: {
        deploymentId: z.string().min(1).optional(),
        service: z.string().min(1).optional(),
        query: z.string().optional(),
        stream: z.enum(["all", "stdout", "stderr"]).optional(),
        ...limit
      },
      annotations: readOnly
    },
    ({ deploymentId, service, query, stream, limit }) =>
      runCall(() =>
        getClient().deploymentLogs.query({ deploymentId, service, query, stream, limit })
      )
  );

  server.registerTool(
    "daoflow_event_timeline",
    {
      title: "Event timeline",
      description:
        "Return the normalized operational event timeline, filterable by time, kind, and severity.",
      inputSchema: {
        since: z.string().optional(),
        kind: z.string().optional(),
        severity: z.string().optional(),
        ...limit
      },
      annotations: readOnly
    },
    ({ since, kind, severity, limit }) =>
      runCall(() => getClient().eventTimeline.query({ since, kind, severity, limit }))
  );

  server.registerTool(
    "daoflow_audit_trail",
    {
      title: "Audit trail",
      description:
        "Return immutable audit records of who did what, with which scope, and the outcome.",
      inputSchema: { since: z.string().optional(), ...limit },
      annotations: readOnly
    },
    ({ since, limit }) => runCall(() => getClient().auditTrail.query({ since, limit }))
  );

  server.registerTool(
    "daoflow_backup_overview",
    {
      title: "Backup overview",
      description: "Return backup policies and run history with status and storage details.",
      inputSchema: limit,
      annotations: readOnly
    },
    ({ limit }) => runCall(() => getClient().backupOverview.query({ limit }))
  );

  server.registerTool(
    "daoflow_persistent_volumes",
    {
      title: "Persistent volumes",
      description: "List registered named volumes with mount status.",
      inputSchema: limit,
      annotations: readOnly
    },
    ({ limit }) => runCall(() => getClient().persistentVolumes.query({ limit }))
  );

  server.registerTool(
    "daoflow_rollback_targets",
    {
      title: "Rollback targets",
      description: "List previous successful deployments a service can roll back to.",
      inputSchema: { serviceId: z.string().min(1) },
      annotations: readOnly
    },
    ({ serviceId }) => runCall(() => getClient().rollbackTargets.query({ serviceId }))
  );

  server.registerTool(
    "daoflow_compose_drift",
    {
      title: "Compose drift report",
      description: "Show config drift between desired Compose state and actual running state.",
      inputSchema: limit,
      annotations: readOnly
    },
    ({ limit }) => runCall(() => getClient().composeDriftReport.query({ limit }))
  );

  server.registerTool(
    "daoflow_config_diff",
    {
      title: "Config diff",
      description: "Compare the resolved configuration of two deployments.",
      inputSchema: {
        deploymentIdA: z.string().min(1),
        deploymentIdB: z.string().min(1)
      },
      annotations: readOnly
    },
    ({ deploymentIdA, deploymentIdB }) =>
      runCall(() => getClient().configDiff.query({ deploymentIdA, deploymentIdB }))
  );

  server.registerTool(
    "daoflow_approval_queue",
    {
      title: "Approval queue",
      description: "List pending approval requests for high-risk operations.",
      inputSchema: limit,
      annotations: readOnly
    },
    ({ limit }) => runCall(() => getClient().approvalQueue.query({ limit }))
  );
}
