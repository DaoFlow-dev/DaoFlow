/**
 * trigger-deploy.ts
 *
 * Creates a deployment record from a service definition.
 * The worker picks up queued deployments via its existing polling loop.
 */

import { and, desc, eq } from "drizzle-orm";
import { basename, isAbsolute } from "node:path";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { services } from "../schema/services";
import { environments, projects } from "../schema/projects";
import {
  createDeploymentRecord,
  type CreateDeploymentInput,
  type DeploymentTrigger
} from "./deployments";
import { dispatchDeploymentExecution } from "./deployment-dispatch";
import type { AppRole } from "@daoflow/shared";
import { asRecord, readString } from "./json-helpers";
import {
  buildComposeSourceSnapshot,
  buildRepositorySourceSnapshot,
  extractReplayableConfigSnapshot
} from "./deployment-source";
import { prepareComposeDeploymentEnvState } from "./compose-env";
import { revalidateProjectSourceForExecution } from "./project-source-execution-validation";

export interface TriggerDeployInput {
  serviceId: string;
  commitSha?: string;
  imageTag?: string;
  requestedByUserId?: string | null;
  requestedByEmail?: string | null;
  requestedByRole?: AppRole | null;
  trigger?: DeploymentTrigger;
}

/** Generate deployment steps based on sourceType. */
function stepsForSourceType(sourceType: string): { label: string; detail: string }[] {
  switch (sourceType) {
    case "compose":
      return [
        { label: "Pull images", detail: "docker-compose pull" },
        { label: "Start services", detail: "docker-compose up -d" },
        { label: "Health check", detail: "Verify containers are healthy" }
      ];
    case "dockerfile":
      return [
        { label: "Clone repository", detail: "git clone" },
        { label: "Build image", detail: "docker build" },
        { label: "Start container", detail: "docker run" },
        { label: "Health check", detail: "Verify container is healthy" }
      ];
    case "image":
      return [
        { label: "Pull image", detail: "docker pull" },
        { label: "Start container", detail: "docker run" },
        { label: "Health check", detail: "Verify container is healthy" }
      ];
    default:
      return [{ label: "Deploy", detail: "Execute deployment" }];
  }
}

function normalizeRepositoryPath(path: string, fallback: string): string {
  if (!path) return fallback;
  return isAbsolute(path) ? basename(path) : path;
}

function hasRepositorySource(project: typeof projects.$inferSelect): boolean {
  return Boolean(
    project.repoUrl || project.repoFullName || project.gitProviderId || project.gitInstallationId
  );
}

function isReplayableUploadedSnapshot(snapshot: Record<string, unknown>): boolean {
  const deploymentSource = readString(snapshot, "deploymentSource");
  const uploadedArtifactId = readString(snapshot, "uploadedArtifactId");

  return (
    (deploymentSource === "uploaded-compose" || deploymentSource === "uploaded-context") &&
    uploadedArtifactId.length > 0
  );
}

async function findLatestReplayableUploadedDeployment(input: {
  projectId: string;
  environmentId: string;
  serviceName: string;
}) {
  const candidates = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, input.projectId),
        eq(deployments.environmentId, input.environmentId),
        eq(deployments.serviceName, input.serviceName),
        eq(deployments.sourceType, "compose")
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(20);

  for (const candidate of candidates) {
    const snapshot = asRecord(candidate.configSnapshot);
    if (isReplayableUploadedSnapshot(snapshot)) {
      return candidate;
    }
  }

  return null;
}

export async function triggerDeploy(input: TriggerDeployInput) {
  // Look up the service
  const [svc] = await db.select().from(services).where(eq(services.id, input.serviceId)).limit(1);

  if (!svc) return { status: "not_found" as const, entity: "service" };

  // Look up the environment to get project context
  const [env] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, svc.environmentId))
    .limit(1);

  if (!env) return { status: "not_found" as const, entity: "environment" };

  const [project] = await db.select().from(projects).where(eq(projects.id, env.projectId)).limit(1);

  if (!project) return { status: "not_found" as const, entity: "project" };

  // Determine target server
  const envConfig = env.config && typeof env.config === "object" ? env.config : {};
  const targetServerId =
    svc.targetServerId ??
    ((envConfig as Record<string, unknown>).targetServerId as string | undefined);

  if (!targetServerId) {
    return { status: "no_server" as const };
  }

  const composeProjectHasRepositorySource =
    svc.sourceType === "compose" ? hasRepositorySource(project) : false;

  if (svc.sourceType === "compose" && composeProjectHasRepositorySource) {
    const sourceValidation = await revalidateProjectSourceForExecution({
      project,
      environment: env
    });

    if (sourceValidation.status === "invalid_source") {
      return sourceValidation;
    }
    if (sourceValidation.status === "provider_unavailable") {
      return sourceValidation;
    }
  }

  const buildConfig = asRecord(svc.config);
  const configSnapshot: Record<string, unknown> = composeProjectHasRepositorySource
    ? buildRepositorySourceSnapshot(project)
    : {};
  let envVarsEncrypted: string | null = null;
  let replayedComposeDeployment: typeof deployments.$inferSelect | null = null;

  if (svc.sourceType === "compose") {
    if (composeProjectHasRepositorySource) {
      Object.assign(
        configSnapshot,
        buildComposeSourceSnapshot({
          project,
          environment: env,
          composeServiceName: svc.composeServiceName
        })
      );

      const envState = await prepareComposeDeploymentEnvState({
        environmentId: env.id,
        branch: typeof configSnapshot.branch === "string" ? configSnapshot.branch : "main"
      });
      configSnapshot.composeEnv = envState.composeEnv;
      envVarsEncrypted = envState.envVarsEncrypted;
    } else {
      replayedComposeDeployment = await findLatestReplayableUploadedDeployment({
        projectId: project.id,
        environmentId: env.id,
        serviceName: svc.name
      });

      if (!replayedComposeDeployment) {
        return {
          status: "invalid_source" as const,
          message:
            `Service ${svc.name} has no repository source and no retained uploaded artifact ` +
            "snapshot available for replay. Re-upload the compose source before triggering a redeploy."
        };
      }

      Object.assign(
        configSnapshot,
        extractReplayableConfigSnapshot(asRecord(replayedComposeDeployment.configSnapshot))
      );
      envVarsEncrypted = replayedComposeDeployment.envVarsEncrypted;
    }
  }

  if (svc.sourceType === "dockerfile") {
    configSnapshot.dockerfile = normalizeRepositoryPath(
      svc.dockerfilePath ?? "Dockerfile",
      "Dockerfile"
    );
    configSnapshot.buildContext = readString(buildConfig, "buildContext", ".");
  }

  if (svc.port) {
    configSnapshot.ports = [svc.port];
  }

  const deployInput: CreateDeploymentInput = {
    projectName: project.name,
    environmentName: env.name,
    serviceName: svc.name,
    sourceType: svc.sourceType as "compose" | "dockerfile" | "image",
    targetServerId,
    commitSha: input.commitSha ?? replayedComposeDeployment?.commitSha ?? "",
    imageTag: input.imageTag ?? svc.imageReference ?? replayedComposeDeployment?.imageTag ?? "",
    requestedByUserId: input.requestedByUserId ?? null,
    requestedByEmail: input.requestedByEmail ?? null,
    requestedByRole: input.requestedByRole ?? null,
    trigger: input.trigger ?? "user",
    steps: stepsForSourceType(svc.sourceType),
    configSnapshot,
    envVarsEncrypted
  };

  const deployment = await createDeploymentRecord(deployInput);
  if (!deployment) return { status: "create_failed" as const };
  await dispatchDeploymentExecution(deployment);

  return { status: "ok" as const, deployment };
}
