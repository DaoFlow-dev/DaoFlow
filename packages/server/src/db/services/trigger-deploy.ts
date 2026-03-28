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
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import {
  createDeploymentRecord,
  type CreateDeploymentInput,
  type DeploymentTrigger
} from "./deployments";
import { dispatchDeploymentExecution } from "./deployment-dispatch";
import type { AppRole } from "@daoflow/shared";
import { asRecord, readString } from "./json-helpers";
import {
  readComposeReadinessProbeFromConfig,
  snapshotComposeReadinessProbe
} from "../../compose-readiness";
import {
  buildComposeSourceSnapshot,
  buildRepositorySourceSnapshot,
  extractReplayableConfigSnapshot,
  resolveComposeImageOverride
} from "./deployment-source";
import { prepareComposeDeploymentEnvState } from "./compose-env";
import { revalidateProjectSourceForExecution } from "./project-source-execution-validation";
import {
  buildComposePreviewEnvEntries,
  deriveComposePreviewMetadata,
  normalizeComposePreviewRequest,
  previewModeAllowsRequest,
  readComposePreviewConfigFromConfig,
  type ComposePreviewRequestInput
} from "../../compose-preview";
import { readServiceRuntimeConfigFromConfig } from "../../service-runtime-config";

export interface TriggerDeployInput {
  serviceId: string;
  commitSha?: string;
  imageTag?: string;
  preview?: ComposePreviewRequestInput;
  requestedByUserId?: string | null;
  requestedByEmail?: string | null;
  requestedByRole?: AppRole | null;
  trigger?: DeploymentTrigger;
}

/** Generate deployment steps based on sourceType. */
function stepsForSourceType(input: {
  sourceType: string;
  targetKind?: string | null;
  composeOperation?: "up" | "down";
  hasPreview?: boolean;
}): { label: string; detail: string }[] {
  const isSwarmCompose =
    input.sourceType === "compose" && input.targetKind === "docker-swarm-manager";
  switch (input.sourceType) {
    case "compose":
      return [
        {
          label: "Prepare deployment inputs",
          detail: input.hasPreview
            ? "Resolved preview compose source inputs, deployment env state, and replayable config snapshot."
            : "Resolved compose source inputs, deployment env state, and replayable config snapshot."
        },
        {
          label: "Queue execution handoff",
          detail:
            input.composeOperation === "down"
              ? isSwarmCompose
                ? "Dispatch the Swarm preview cleanup to the execution plane."
                : "Dispatch the compose preview cleanup to the execution plane."
              : isSwarmCompose
                ? "Dispatch the Swarm stack deployment to the execution plane."
                : "Dispatch the compose deployment to the execution plane."
        }
      ];
    case "dockerfile":
      return [
        {
          label: "Prepare deployment inputs",
          detail: "Resolved Dockerfile source inputs and created an immutable deployment snapshot."
        },
        {
          label: "Queue execution handoff",
          detail: "Dispatch the Dockerfile deployment to the execution plane."
        }
      ];
    case "image":
      return [
        {
          label: "Prepare deployment inputs",
          detail: "Resolved the image reference and created an immutable deployment snapshot."
        },
        {
          label: "Queue execution handoff",
          detail: "Dispatch the image deployment to the execution plane."
        }
      ];
    default:
      return [{ label: "Queue execution handoff", detail: "Dispatch the deployment job." }];
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
  const [targetServer] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, targetServerId))
    .limit(1);

  if (!targetServer) {
    return { status: "no_server" as const };
  }

  const composeProjectHasRepositorySource =
    svc.sourceType === "compose" ? hasRepositorySource(project) : false;
  if (input.preview && svc.sourceType !== "compose") {
    return {
      status: "invalid_preview" as const,
      message: "Preview deployments are only supported for compose services."
    };
  }

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
  const readinessProbe = readComposeReadinessProbeFromConfig(buildConfig);
  const previewConfig = readComposePreviewConfigFromConfig(buildConfig);
  const runtimeConfig = readServiceRuntimeConfigFromConfig(buildConfig);
  const configSnapshot: Record<string, unknown> = composeProjectHasRepositorySource
    ? buildRepositorySourceSnapshot(project)
    : {};
  let envVarsEncrypted: string | null = null;
  let replayedComposeDeployment: typeof deployments.$inferSelect | null = null;

  if (svc.sourceType === "compose") {
    const previewRequest = input.preview ? normalizeComposePreviewRequest(input.preview) : null;
    if (previewRequest) {
      if (!composeProjectHasRepositorySource) {
        return {
          status: "invalid_preview" as const,
          message:
            "Preview deployments require a git-backed compose service so DaoFlow can check out the requested branch."
        };
      }
      if (!previewConfig?.enabled) {
        return {
          status: "invalid_preview" as const,
          message: "Preview deployments are not enabled for this compose service."
        };
      }
      if (!previewModeAllowsRequest(previewConfig.mode, previewRequest)) {
        return {
          status: "invalid_preview" as const,
          message: `Preview mode ${previewConfig.mode} does not allow ${previewRequest.target} preview requests.`
        };
      }
    }

    if (composeProjectHasRepositorySource) {
      Object.assign(
        configSnapshot,
        buildComposeSourceSnapshot({
          project,
          environment: env,
          composeServiceName: svc.composeServiceName
        })
      );

      let previewMetadata = null;
      if (previewRequest && previewConfig) {
        previewMetadata = deriveComposePreviewMetadata({
          config: previewConfig,
          request: previewRequest,
          projectName: project.name,
          environmentName: env.name,
          serviceName: svc.name,
          baseStackName: project.name
        });
        configSnapshot.branch = previewRequest.branch;
        configSnapshot.composeEnvBranch = previewMetadata.envBranch;
        configSnapshot.stackName = previewMetadata.stackName;
        configSnapshot.composeOperation = previewRequest.action === "destroy" ? "down" : "up";
        configSnapshot.preview = previewMetadata;
      } else {
        configSnapshot.composeOperation = "up";
      }

      const envState = await prepareComposeDeploymentEnvState({
        environmentId: env.id,
        serviceId: svc.id,
        branch:
          typeof configSnapshot.composeEnvBranch === "string"
            ? configSnapshot.composeEnvBranch
            : typeof configSnapshot.branch === "string"
              ? configSnapshot.branch
              : "main",
        additionalEntries:
          previewMetadata !== null ? buildComposePreviewEnvEntries(previewMetadata) : undefined
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

  delete configSnapshot.readinessProbe;
  if (readinessProbe) {
    configSnapshot.readinessProbe = snapshotComposeReadinessProbe({
      probe: readinessProbe,
      serviceName: svc.composeServiceName ?? svc.name
    });
  }
  if (runtimeConfig) {
    configSnapshot.runtimeConfig = runtimeConfig;
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

  const effectiveImageTag =
    input.imageTag ?? svc.imageReference ?? replayedComposeDeployment?.imageTag ?? "";
  const composeImageOverride =
    svc.sourceType === "compose"
      ? resolveComposeImageOverride({
          serviceName: svc.name,
          composeServiceName: svc.composeServiceName,
          requestedImageTag: input.imageTag,
          effectiveImageTag,
          serviceImageReference: svc.imageReference,
          existingOverride: configSnapshot.composeImageOverride
        })
      : undefined;

  if (composeImageOverride) {
    configSnapshot.composeImageOverride = composeImageOverride;
  } else {
    delete configSnapshot.composeImageOverride;
  }

  const deployInput: CreateDeploymentInput = {
    projectName: project.name,
    environmentName: env.name,
    serviceName: svc.name,
    sourceType: svc.sourceType as "compose" | "dockerfile" | "image",
    targetServerId,
    commitSha: input.commitSha ?? replayedComposeDeployment?.commitSha ?? "",
    imageTag: effectiveImageTag,
    requestedByUserId: input.requestedByUserId ?? null,
    requestedByEmail: input.requestedByEmail ?? null,
    requestedByRole: input.requestedByRole ?? null,
    trigger: input.trigger ?? "user",
    steps: stepsForSourceType({
      sourceType: svc.sourceType,
      targetKind: targetServer.kind,
      composeOperation: configSnapshot.composeOperation === "down" ? "down" : "up",
      hasPreview: configSnapshot.preview !== undefined
    }),
    configSnapshot,
    envVarsEncrypted
  };

  const deployment = await createDeploymentRecord(deployInput);
  if (!deployment) return { status: "create_failed" as const };
  await dispatchDeploymentExecution(deployment);

  return { status: "ok" as const, deployment };
}
