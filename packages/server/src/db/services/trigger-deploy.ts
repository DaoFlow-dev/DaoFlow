/**
 * trigger-deploy.ts
 *
 * Creates a deployment record from a service definition.
 * The worker picks up queued deployments via its existing polling loop.
 */

import { eq } from "drizzle-orm";
import { basename, isAbsolute } from "node:path";
import { db } from "../connection";
import { services } from "../schema/services";
import { environments, projects } from "../schema/projects";
import { createDeploymentRecord, type CreateDeploymentInput } from "./deployments";
import { dispatchDeploymentExecution } from "./deployment-dispatch";
import type { AppRole } from "@daoflow/shared";
import { asRecord, readString } from "./json-helpers";

export interface TriggerDeployInput {
  serviceId: string;
  commitSha?: string;
  imageTag?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
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

  const environmentConfig = asRecord(env.config);
  const buildConfig = asRecord(svc.config);

  const configSnapshot: Record<string, unknown> = {
    repoUrl: project.repoUrl ?? null,
    branch: project.defaultBranch ?? readString(asRecord(project.config), "defaultBranch", "main")
  };

  if (svc.sourceType === "compose") {
    configSnapshot.composeFilePath = normalizeRepositoryPath(
      project.composePath ?? readString(environmentConfig, "composeFilePath", "docker-compose.yml"),
      "docker-compose.yml"
    );
    if (svc.composeServiceName) {
      configSnapshot.composeServiceName = svc.composeServiceName;
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
    commitSha: input.commitSha ?? "",
    imageTag: input.imageTag ?? svc.imageReference ?? "",
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole,
    steps: stepsForSourceType(svc.sourceType),
    configSnapshot
  };

  const deployment = await createDeploymentRecord(deployInput);
  if (!deployment) return { status: "create_failed" as const };
  await dispatchDeploymentExecution(deployment);

  return { status: "ok" as const, deployment };
}
