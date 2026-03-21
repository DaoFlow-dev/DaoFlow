import { and, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db } from "../connection";
import { deploymentLogs, deployments } from "../schema/deployments";
import { buildDeploymentIndex } from "./deployment-record-views";
import { asRecord, readString } from "./json-helpers";

export type DeploymentLogStream = "all" | "stdout" | "stderr";

export interface ListDeploymentLogsInput {
  deploymentId?: string;
  serviceName?: string;
  query?: string;
  stream?: DeploymentLogStream;
  limit?: number;
}

function buildDeploymentLogFilters(input: ListDeploymentLogsInput) {
  const filters: SQL[] = [];

  if (input.deploymentId) {
    filters.push(eq(deploymentLogs.deploymentId, input.deploymentId));
  }

  if (input.serviceName) {
    filters.push(eq(deployments.serviceName, input.serviceName));
  }

  if (input.query) {
    filters.push(ilike(deploymentLogs.message, `%${input.query}%`));
  }

  if (input.stream === "stderr") {
    filters.push(
      sql`(coalesce(${deploymentLogs.metadata} ->> 'stream', '') = 'stderr' or ${deploymentLogs.level} = 'error')`
    );
  }

  if (input.stream === "stdout") {
    filters.push(
      sql`(coalesce(${deploymentLogs.metadata} ->> 'stream', 'stdout') = 'stdout' and ${deploymentLogs.level} <> 'error')`
    );
  }

  return filters;
}

export async function listDeploymentLogs(input: ListDeploymentLogsInput = {}) {
  const limit = input.limit ?? 18;
  const filters = buildDeploymentLogFilters(input);
  const condition = filters.length > 0 ? and(...filters) : undefined;
  const baseQuery = db
    .select({
      log: deploymentLogs,
      deployment: deployments
    })
    .from(deploymentLogs)
    .innerJoin(deployments, eq(deploymentLogs.deploymentId, deployments.id));

  const rows = await (condition ? baseQuery.where(condition) : baseQuery)
    .orderBy(desc(deploymentLogs.createdAt))
    .limit(limit);
  const deploymentRows = [
    ...new Map(rows.map((row) => [row.deployment.id, row.deployment])).values()
  ];
  const index = await buildDeploymentIndex(deploymentRows);

  const [counts] = await db
    .select({
      totalLines: sql<number>`count(*)`,
      stderrLines: sql<number>`count(*) filter (where ${deploymentLogs.level} = 'error')`,
      deploymentCount: sql<number>`count(distinct ${deploymentLogs.deploymentId})`
    })
    .from(deploymentLogs)
    .innerJoin(deployments, eq(deploymentLogs.deploymentId, deployments.id))
    .where(condition);

  return {
    summary: {
      totalLines: Number(counts?.totalLines ?? 0),
      stderrLines: Number(counts?.stderrLines ?? 0),
      deploymentCount: Number(counts?.deploymentCount ?? 0)
    },
    lines: rows.map(({ log, deployment }) => {
      const metadata = asRecord(log.metadata);
      const project = index.projectById.get(deployment.projectId);
      const environment = index.environmentById.get(deployment.environmentId);

      return {
        ...log,
        id: readString(metadata, "seedId", `deployment_log_${log.id}`),
        stream:
          readString(metadata, "stream") === "stderr" || log.level === "error"
            ? ("stderr" as const)
            : ("stdout" as const),
        lineNumber: typeof metadata.lineNumber === "number" ? metadata.lineNumber : log.id,
        createdAt: log.createdAt.toISOString(),
        projectName: project?.name ?? "",
        environmentName: environment?.name ?? "",
        serviceName: deployment.serviceName
      };
    })
  };
}
