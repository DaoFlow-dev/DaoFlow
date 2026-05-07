import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import {
  developmentTaskEvents,
  developmentTaskRuns,
  developmentTasks,
  sandboxRunnerProfiles
} from "../schema/development-tasks";
import { projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { resolveSandboxRunnerCapabilities } from "./development-task-runner-capabilities";
import { asRecord, newId } from "./json-helpers";

export interface DevelopmentTaskClaimActor {
  runnerId: string;
  runnerLabel: string;
}

export async function claimNextQueuedDevelopmentTask(actor: DevelopmentTaskClaimActor) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        task: developmentTasks,
        runnerProfile: sandboxRunnerProfiles
      })
      .from(developmentTasks)
      .innerJoin(projects, eq(projects.id, developmentTasks.projectId))
      .innerJoin(servers, eq(servers.teamId, projects.teamId))
      .innerJoin(
        sandboxRunnerProfiles,
        and(
          eq(sandboxRunnerProfiles.serverId, servers.id),
          eq(sandboxRunnerProfiles.status, "enabled")
        )
      )
      .where(eq(developmentTasks.status, "queued"))
      .orderBy(
        asc(developmentTasks.priority),
        asc(developmentTasks.createdAt),
        sql`
        CASE
          WHEN ${sandboxRunnerProfiles.provider} = 'host_docker' THEN 0
          WHEN ${sandboxRunnerProfiles.provider} = 'sandbank_boxlite' THEN 1
          ELSE 2
        END,
        ${sandboxRunnerProfiles.createdAt} ASC
      `
      )
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate) {
      return null;
    }
    const { runnerProfile } = candidate;
    const runnerMetadata = asRecord(runnerProfile.metadata);
    const capabilities = resolveSandboxRunnerCapabilities({
      provider: runnerProfile.provider,
      metadata: runnerMetadata
    });

    const [task] = await tx
      .update(developmentTasks)
      .set({
        status: "running",
        updatedAt: now
      })
      .where(and(eq(developmentTasks.status, "queued"), eq(developmentTasks.id, candidate.task.id)))
      .returning();

    if (!task) {
      return null;
    }

    const runId = newId();
    const [run] = await tx
      .insert(developmentTaskRuns)
      .values({
        id: runId,
        taskId: task.id,
        status: "claimed",
        runnerId: actor.runnerId,
        runnerProfileId: runnerProfile.id,
        sandboxProvider: runnerProfile.provider,
        codexProfile: "daoflow",
        metadata: {
          runnerLabel: actor.runnerLabel,
          runnerProfileName: runnerProfile.name,
          image: runnerProfile.image,
          serverId: runnerProfile.serverId,
          cpuLimit: runnerProfile.cpuLimit,
          memoryLimitMb: runnerProfile.memoryLimitMb,
          diskLimitMb: runnerProfile.diskLimitMb,
          networkPolicy: runnerProfile.networkPolicy,
          allowedCommands: runnerProfile.allowedCommands,
          validationCommands: runnerProfile.validationCommands,
          capabilities,
          timeoutMinutes: runnerProfile.timeoutMinutes,
          codexAuthMode: runnerProfile.codexAuthMode,
          codexConfigTemplate: runnerProfile.codexConfigTemplate
        },
        startedAt: now,
        updatedAt: now
      })
      .returning();

    await tx
      .update(developmentTasks)
      .set({
        currentRunId: run.id,
        updatedAt: now
      })
      .where(eq(developmentTasks.id, task.id));

    await tx.insert(developmentTaskEvents).values({
      id: newId(),
      taskId: task.id,
      runId: run.id,
      kind: "run.claimed",
      summary: `${actor.runnerLabel} claimed the development task.`,
      metadata: {
        runnerId: actor.runnerId,
        runnerProfileId: runnerProfile.id,
        sandboxProvider: runnerProfile.provider,
        capabilities
      }
    });

    await tx.insert(auditEntries).values({
      actorType: "system",
      actorId: actor.runnerId,
      actorEmail: "system@daoflow.local",
      actorRole: "agent",
      targetResource: `development_task/${task.id}`,
      action: "development_task.claim",
      inputSummary: `${actor.runnerLabel} claimed development task ${task.id}`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: {
        resourceType: "development_task",
        resourceId: task.id,
        runId: run.id,
        runnerId: actor.runnerId,
        runnerProfileId: runnerProfile.id,
        sandboxProvider: runnerProfile.provider
      }
    });

    return { task: { ...task, status: "running", currentRunId: run.id }, run };
  });
}
