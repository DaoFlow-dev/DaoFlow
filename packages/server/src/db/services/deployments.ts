import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { deploymentLogs, deployments, deploymentSteps } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { normalizeDeploymentStatus, type AppRole } from "@daoflow/shared";
import {
  newId as id,
  asRecord,
  readString,
  readRecordArray,
  readStringArray
} from "./json-helpers";

export type DeploymentStatus =
  | "queued"
  | "prepare"
  | "deploy"
  | "finalize"
  | "completed"
  | "failed";
export type DeploymentSourceType = "compose" | "dockerfile" | "image";

async function loadProjectEnvironmentByNames(projectName: string, environmentName: string) {
  const [project] = await db.select().from(projects).where(eq(projects.name, projectName)).limit(1);
  if (!project) return null;

  const [environment] = await db
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, project.id), eq(environments.name, environmentName)))
    .limit(1);

  if (!environment) return null;
  return { project, environment };
}

async function buildDeploymentIndex(deploymentRows: (typeof deployments.$inferSelect)[]) {
  if (deploymentRows.length === 0) {
    return {
      projectById: new Map<string, typeof projects.$inferSelect>(),
      environmentById: new Map<string, typeof environments.$inferSelect>(),
      serverById: new Map<string, typeof servers.$inferSelect>(),
      serviceByKey: new Map<string, typeof services.$inferSelect>()
    };
  }

  const projectIds = [...new Set(deploymentRows.map((row) => row.projectId))];
  const environmentIds = [...new Set(deploymentRows.map((row) => row.environmentId))];
  const serverIds = [...new Set(deploymentRows.map((row) => row.targetServerId))];

  const [projectRows, environmentRows, serverRows, serviceRows] = await Promise.all([
    db.select().from(projects).where(inArray(projects.id, projectIds)),
    db.select().from(environments).where(inArray(environments.id, environmentIds)),
    db.select().from(servers).where(inArray(servers.id, serverIds)),
    db.select().from(services).where(inArray(services.environmentId, environmentIds))
  ]);

  return {
    projectById: new Map(projectRows.map((row) => [row.id, row])),
    environmentById: new Map(environmentRows.map((row) => [row.id, row])),
    serverById: new Map(serverRows.map((row) => [row.id, row])),
    serviceByKey: new Map(
      serviceRows.map((row) => [`${row.projectId}:${row.environmentId}:${row.name}`, row] as const)
    )
  };
}

function buildDeploymentView(
  deployment: typeof deployments.$inferSelect,
  project: typeof projects.$inferSelect | undefined,
  environment: typeof environments.$inferSelect | undefined,
  server: typeof servers.$inferSelect | undefined,
  service: typeof services.$inferSelect | undefined,
  steps: (typeof deploymentSteps.$inferSelect)[]
) {
  const snapshot = asRecord(deployment.configSnapshot);
  const status = normalizeDeploymentStatus(deployment.status, deployment.conclusion);

  return {
    ...deployment,
    status,
    serviceId: service?.id ?? null,
    projectName: project?.name ?? readString(snapshot, "projectName", deployment.projectId),
    environmentName:
      environment?.name ?? readString(snapshot, "environmentName", deployment.environmentId),
    targetServerName:
      server?.name ?? readString(snapshot, "targetServerName", deployment.targetServerId),
    targetServerHost:
      server?.host ?? readString(snapshot, "targetServerHost", deployment.targetServerId),
    createdAt: deployment.createdAt.toISOString(),
    startedAt: deployment.createdAt.toISOString(),
    finishedAt: deployment.concludedAt?.toISOString() ?? null,
    steps: steps.map((step) => ({
      ...step,
      position: step.sortOrder,
      startedAt: step.startedAt?.toISOString() ?? null,
      finishedAt: step.completedAt?.toISOString() ?? null
    }))
  };
}

export interface CreateDeploymentInput {
  projectName: string;
  environmentName: string;
  serviceName: string;
  sourceType: DeploymentSourceType;
  targetServerId: string;
  commitSha: string;
  imageTag: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
  steps: readonly { label: string; detail: string }[];
}

export async function createDeploymentRecord(input: CreateDeploymentInput) {
  const [server, projectEnvironment] = await Promise.all([
    db.select().from(servers).where(eq(servers.id, input.targetServerId)).limit(1),
    loadProjectEnvironmentByNames(input.projectName, input.environmentName)
  ]);

  if (!server[0] || !projectEnvironment) return null;

  const deploymentId = id();
  const now = new Date();

  await db.insert(deployments).values({
    id: deploymentId,
    projectId: projectEnvironment.project.id,
    environmentId: projectEnvironment.environment.id,
    targetServerId: input.targetServerId,
    serviceName: input.serviceName,
    sourceType: input.sourceType,
    commitSha: input.commitSha,
    imageTag: input.imageTag,
    configSnapshot: {
      projectName: input.projectName,
      environmentName: input.environmentName,
      targetServerName: server[0].name,
      targetServerHost: server[0].host,
      queueName: "docker-ssh",
      workerHint: `ssh://${server[0].name}/docker-engine`
    },
    status: "queued",
    trigger: "user",
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole,
    updatedAt: now
  });

  await db.insert(deploymentSteps).values(
    input.steps.map((step, index) => ({
      deploymentId,
      label: step.label,
      detail: step.detail,
      status: "pending" as const,
      sortOrder: index + 1
    }))
  );

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `deployment/${deploymentId}`,
    action: "deployment.create",
    inputSummary: `Queued ${input.serviceName} for ${input.environmentName}.`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      resourceType: "deployment",
      resourceId: deploymentId,
      resourceLabel: `${input.serviceName}@${input.environmentName}`,
      detail: `Queued ${input.serviceName} for ${input.environmentName}.`
    }
  });

  await db.insert(deploymentLogs).values({
    deploymentId,
    level: "info",
    message: `Control plane queued ${input.serviceName} for ${input.environmentName} using ${input.sourceType} inputs.`,
    source: "system",
    createdAt: now
  });

  await db.insert(events).values({
    kind: "execution.job.created",
    resourceType: "deployment",
    resourceId: deploymentId,
    summary: "Deployment record queued.",
    detail: `${input.serviceName} is waiting in the docker-ssh handoff queue.`,
    severity: "info",
    metadata: {
      serviceName: input.serviceName,
      actorLabel: "control-plane"
    },
    createdAt: now
  });

  return getDeploymentRecord(deploymentId);
}

export async function getDeploymentRecord(deploymentId: string) {
  const rows = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
  if (!rows[0]) return null;

  const steps = await db
    .select()
    .from(deploymentSteps)
    .where(eq(deploymentSteps.deploymentId, deploymentId))
    .orderBy(deploymentSteps.sortOrder);

  const index = await buildDeploymentIndex(rows);

  return buildDeploymentView(
    rows[0],
    index.projectById.get(rows[0].projectId),
    index.environmentById.get(rows[0].environmentId),
    index.serverById.get(rows[0].targetServerId),
    index.serviceByKey.get(`${rows[0].projectId}:${rows[0].environmentId}:${rows[0].serviceName}`),
    steps
  );
}

export async function listDeploymentRecords(status?: string, limit = 20) {
  const baseQuery = db.select().from(deployments);
  const rows = status
    ? await (() => {
        switch (status) {
          case "healthy":
            return baseQuery
              .where(
                and(eq(deployments.status, "completed"), eq(deployments.conclusion, "succeeded"))
              )
              .orderBy(desc(deployments.createdAt))
              .limit(limit);
          case "failed":
            return baseQuery
              .where(sql`${deployments.status} = 'failed' or ${deployments.conclusion} = 'failed'`)
              .orderBy(desc(deployments.createdAt))
              .limit(limit);
          case "running":
            return baseQuery
              .where(sql`${deployments.status} in ('prepare', 'deploy', 'finalize', 'running')`)
              .orderBy(desc(deployments.createdAt))
              .limit(limit);
          default:
            return baseQuery
              .where(
                sql`${deployments.status} not in ('failed', 'completed', 'prepare', 'deploy', 'finalize', 'running')
                    and coalesce(${deployments.conclusion}, '') <> 'failed'`
              )
              .orderBy(desc(deployments.createdAt))
              .limit(limit);
        }
      })()
    : await baseQuery.orderBy(desc(deployments.createdAt)).limit(limit);
  if (rows.length === 0) return [];
  const index = await buildDeploymentIndex(rows);

  const steps = await db
    .select()
    .from(deploymentSteps)
    .where(
      inArray(
        deploymentSteps.deploymentId,
        rows.map((row) => row.id)
      )
    )
    .orderBy(deploymentSteps.sortOrder);

  const stepsByDeploymentId = new Map<string, (typeof deploymentSteps.$inferSelect)[]>();
  for (const step of steps) {
    const collection = stepsByDeploymentId.get(step.deploymentId) ?? [];
    collection.push(step);
    stepsByDeploymentId.set(step.deploymentId, collection);
  }

  const mapped = rows.map((deployment) =>
    buildDeploymentView(
      deployment,
      index.projectById.get(deployment.projectId),
      index.environmentById.get(deployment.environmentId),
      index.serverById.get(deployment.targetServerId),
      index.serviceByKey.get(
        `${deployment.projectId}:${deployment.environmentId}:${deployment.serviceName}`
      ),
      stepsByDeploymentId.get(deployment.id) ?? []
    )
  );

  return status ? mapped.filter((deployment) => deployment.status === status) : mapped;
}

export async function listDeploymentLogs(deploymentId?: string, limit = 18) {
  const query = deploymentId
    ? db.select().from(deploymentLogs).where(eq(deploymentLogs.deploymentId, deploymentId))
    : db.select().from(deploymentLogs);

  const logs = await query.orderBy(desc(deploymentLogs.createdAt)).limit(limit);
  const deploymentIds = [...new Set(logs.map((log) => log.deploymentId))];
  const deploymentRows =
    deploymentIds.length > 0
      ? await db.select().from(deployments).where(inArray(deployments.id, deploymentIds))
      : [];
  const index = await buildDeploymentIndex(deploymentRows);
  const deploymentById = new Map(deploymentRows.map((row) => [row.id, row]));

  const [counts] = await db
    .select({
      totalLines: sql<number>`count(*)`,
      stderrLines: sql<number>`count(*) filter (where ${deploymentLogs.level} = 'error')`,
      deploymentCount: sql<number>`count(distinct ${deploymentLogs.deploymentId})`
    })
    .from(deploymentLogs);

  return {
    summary: {
      totalLines: Number(counts?.totalLines ?? 0),
      stderrLines: Number(counts?.stderrLines ?? 0),
      deploymentCount: Number(counts?.deploymentCount ?? 0)
    },
    lines: logs.map((log) => {
      const metadata = asRecord(log.metadata);
      const deployment = deploymentById.get(log.deploymentId);
      const project = deployment ? index.projectById.get(deployment.projectId) : undefined;
      const environment = deployment
        ? index.environmentById.get(deployment.environmentId)
        : undefined;

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
        serviceName: deployment?.serviceName ?? ""
      };
    })
  };
}

export async function listDeploymentInsights(limit = 6) {
  const rows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.status, "failed"))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);

  const index = await buildDeploymentIndex(rows);

  return rows.map((deployment) => {
    const snapshot = asRecord(deployment.configSnapshot);
    const insight = asRecord(snapshot.insight);
    const healthyBaseline = asRecord(insight.healthyBaseline);

    return {
      deploymentId: deployment.id,
      projectName:
        index.projectById.get(deployment.projectId)?.name ??
        readString(snapshot, "projectName", deployment.projectId),
      environmentName:
        index.environmentById.get(deployment.environmentId)?.name ??
        readString(snapshot, "environmentName", deployment.environmentId),
      serviceName: deployment.serviceName,
      status: normalizeDeploymentStatus(deployment.status, deployment.conclusion),
      summary: readString(insight, "summary", `Deployment ${deployment.id} failed.`),
      suspectedRootCause: readString(
        insight,
        "suspectedRootCause",
        typeof deployment.error === "object" && deployment.error
          ? readString(asRecord(deployment.error), "suspectedRootCause", "Unknown")
          : "Unknown"
      ),
      safeActions: readStringArray(insight, "safeActions"),
      evidence: readRecordArray(insight, "evidence").map((item) => ({
        kind: readString(item, "kind"),
        id: readString(item, "id"),
        title: readString(item, "title"),
        detail: readString(item, "detail")
      })),
      healthyBaseline:
        Object.keys(healthyBaseline).length > 0
          ? {
              deploymentId: readString(healthyBaseline, "deploymentId"),
              commitSha: readString(healthyBaseline, "commitSha"),
              imageTag: readString(healthyBaseline, "imageTag"),
              finishedAt:
                typeof healthyBaseline.finishedAt === "string" ? healthyBaseline.finishedAt : null
            }
          : null
    };
  });
}

export async function listDeploymentRollbackPlans(limit = 6) {
  const rows = await db
    .select()
    .from(deployments)
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
  const index = await buildDeploymentIndex(rows);

  return rows.map((deployment) => {
    const snapshot = asRecord(deployment.configSnapshot);
    const rollbackPlan = asRecord(snapshot.rollbackPlan);
    const currentStatus = normalizeDeploymentStatus(deployment.status, deployment.conclusion);

    if (Object.keys(rollbackPlan).length > 0) {
      return {
        deploymentId: deployment.id,
        projectName:
          index.projectById.get(deployment.projectId)?.name ??
          readString(snapshot, "projectName", deployment.projectId),
        environmentName:
          index.environmentById.get(deployment.environmentId)?.name ??
          readString(snapshot, "environmentName", deployment.environmentId),
        serviceName: deployment.serviceName,
        currentStatus,
        isAvailable: rollbackPlan.isAvailable !== false,
        reason: readString(rollbackPlan, "reason"),
        targetDeploymentId: readString(rollbackPlan, "targetDeploymentId", ""),
        targetCommitSha: readString(rollbackPlan, "targetCommitSha", ""),
        targetImageTag: readString(rollbackPlan, "targetImageTag", ""),
        checks: readStringArray(rollbackPlan, "checks"),
        steps: readStringArray(rollbackPlan, "steps")
      };
    }

    if (currentStatus === "healthy") {
      return {
        deploymentId: deployment.id,
        projectName:
          index.projectById.get(deployment.projectId)?.name ??
          readString(snapshot, "projectName", deployment.projectId),
        environmentName:
          index.environmentById.get(deployment.environmentId)?.name ??
          readString(snapshot, "environmentName", deployment.environmentId),
        serviceName: deployment.serviceName,
        currentStatus,
        isAvailable: false,
        reason: "Current deployment is already healthy; rollback is not recommended.",
        targetDeploymentId: "",
        targetCommitSha: "",
        targetImageTag: "",
        checks: ["Continue observing logs and readiness checks before taking action."],
        steps: ["No rollback steps are suggested while the deployment remains healthy."]
      };
    }

    return {
      deploymentId: deployment.id,
      projectName:
        index.projectById.get(deployment.projectId)?.name ??
        readString(snapshot, "projectName", deployment.projectId),
      environmentName:
        index.environmentById.get(deployment.environmentId)?.name ??
        readString(snapshot, "environmentName", deployment.environmentId),
      serviceName: deployment.serviceName,
      currentStatus,
      isAvailable: false,
      reason: "No deterministic rollback target is available yet.",
      targetDeploymentId: "",
      targetCommitSha: "",
      targetImageTag: "",
      checks: ["Capture a healthy baseline before offering rollback automation."],
      steps: ["Promote one deployment to healthy before constructing a rollback plan."]
    };
  });
}

// ─── Cancel deployment ──────────────────────────────────────

export interface CancelDeploymentInput {
  deploymentId: string;
  cancelledByUserId: string;
  cancelledByEmail: string;
  cancelledByRole: AppRole;
}

export async function cancelDeployment(input: CancelDeploymentInput) {
  const [deployment] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, input.deploymentId))
    .limit(1);

  if (!deployment) return { status: "not-found" as const };

  const currentStatus = normalizeDeploymentStatus(deployment.status, deployment.conclusion);
  if (currentStatus !== "queued" && currentStatus !== "running") {
    return { status: "invalid-state" as const, currentStatus };
  }

  await db
    .update(deployments)
    .set({
      status: "failed",
      conclusion: "cancelled",
      error: { reason: "Cancelled by user", cancelledBy: input.cancelledByEmail },
      concludedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(deployments.id, input.deploymentId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.cancelledByUserId,
    actorEmail: input.cancelledByEmail,
    actorRole: input.cancelledByRole,
    targetResource: `deployment/${input.deploymentId}`,
    action: "deployment.cancel",
    inputSummary: `Cancelled deployment ${input.deploymentId}.`,
    permissionScope: "deploy:cancel",
    outcome: "success",
    metadata: {
      resourceType: "deployment",
      resourceId: input.deploymentId,
      detail: `Cancelled deployment from ${currentStatus} state.`
    }
  });

  await db.insert(events).values({
    kind: "deployment.cancelled",
    resourceType: "deployment",
    resourceId: input.deploymentId,
    summary: "Deployment cancelled by user.",
    detail: `${input.cancelledByEmail} cancelled a ${currentStatus} deployment.`,
    severity: "warning",
    metadata: { previousStatus: currentStatus, cancelledBy: input.cancelledByEmail },
    createdAt: new Date()
  });

  return { status: "cancelled" as const, deploymentId: input.deploymentId };
}

// ─── Deployment diff ────────────────────────────────────────

export async function deploymentDiff(deploymentIdA: string, deploymentIdB: string) {
  const [a, b] = await Promise.all([
    getDeploymentRecord(deploymentIdA),
    getDeploymentRecord(deploymentIdB)
  ]);

  if (!a || !b) return null;

  return {
    a: {
      id: a.id,
      serviceName: a.serviceName,
      status: a.status,
      commitSha: a.commitSha,
      imageTag: a.imageTag,
      sourceType: a.sourceType,
      createdAt: a.createdAt,
      finishedAt: a.finishedAt,
      stepCount: a.steps.length
    },
    b: {
      id: b.id,
      serviceName: b.serviceName,
      status: b.status,
      commitSha: b.commitSha,
      imageTag: b.imageTag,
      sourceType: b.sourceType,
      createdAt: b.createdAt,
      finishedAt: b.finishedAt,
      stepCount: b.steps.length
    },
    diffs: {
      sameService: a.serviceName === b.serviceName,
      commitChanged: a.commitSha !== b.commitSha,
      imageChanged: a.imageTag !== b.imageTag,
      sourceTypeChanged: a.sourceType !== b.sourceType,
      statusChanged: a.status !== b.status
    }
  };
}
