import { eq } from "drizzle-orm";
import type { ComposeBuildPlan } from "../../compose-build-plan";
import { materializeComposeWorkspaceArtifacts } from "../../compose-workspace-artifacts";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { resolveComposeFilePath, resolveComposeImageOverride } from "./deployment-source";
import { asRecord } from "./json-helpers";
import { materializeProjectSourceInspection } from "./project-source-checkout-inspection";

export type DeploymentPlanSourceType = "compose" | "dockerfile" | "image";

export function hasRepositorySource(project: typeof projects.$inferSelect): boolean {
  return Boolean(
    project.repoUrl || (project.repoFullName && project.gitProviderId && project.gitInstallationId)
  );
}

export async function materializeComposePlanningPreflight(input: {
  project: typeof projects.$inferSelect;
  environment: typeof environments.$inferSelect;
  branch: string;
  imageTag: string | null;
  serviceName: string;
  composeServiceName?: string | null;
  serviceImageReference?: string | null;
}): Promise<
  | {
      status: "ok";
      composeContent: string;
      repoDefaultContent: string | null;
      buildPlan: ComposeBuildPlan;
      warnings: string[];
    }
  | {
      status: "fail";
      reason: string;
    }
> {
  const inspection = await materializeProjectSourceInspection({
    project: {
      repoUrl: input.project.repoUrl,
      repoFullName: input.project.repoFullName,
      gitProviderId: input.project.gitProviderId,
      gitInstallationId: input.project.gitInstallationId,
      repositoryPreparation: asRecord(input.project.config).repositoryPreparation
    },
    branch: input.branch
  });

  if (inspection.status !== "ok") {
    return {
      status: "fail",
      reason: inspection.reason
    };
  }

  try {
    const composeFilePath = resolveComposeFilePath({
      project: input.project,
      environment: input.environment
    });
    const composeImageOverride = resolveComposeImageOverride({
      serviceName: input.serviceName,
      composeServiceName: input.composeServiceName,
      effectiveImageTag: input.imageTag,
      serviceImageReference: input.serviceImageReference
    });
    const materialized = materializeComposeWorkspaceArtifacts({
      workDir: inspection.workDir,
      composeFile: composeFilePath,
      branch: input.branch,
      sourceProvenance: "repository-checkout",
      deploymentState: { envState: { kind: "queued", entries: [] } },
      imageOverride: composeImageOverride
    });

    return {
      status: "ok",
      composeContent: materialized.composeInputs.frozenInputs.composeFile.contents,
      repoDefaultContent: materialized.repoDefaultContent,
      buildPlan: materialized.composeBuildPlan,
      warnings: materialized.composeInputs.manifest.warnings
    };
  } catch (error) {
    return {
      status: "fail",
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    inspection.cleanup();
  }
}

export function normalizeDeploymentPlanSourceType(value: string): DeploymentPlanSourceType {
  if (value === "dockerfile" || value === "image") {
    return value;
  }

  return "compose";
}

export async function resolveTargetServer(
  serverRef: string | undefined,
  fallbackServerId: string | null
) {
  const ref = serverRef?.trim();

  if (ref) {
    const [byId] = await db.select().from(servers).where(eq(servers.id, ref)).limit(1);
    if (byId) {
      return byId;
    }

    const [byName] = await db.select().from(servers).where(eq(servers.name, ref)).limit(1);
    if (byName) {
      return byName;
    }

    throw new Error(`Server "${ref}" not found.`);
  }

  if (!fallbackServerId) {
    return null;
  }

  const [fallback] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, fallbackServerId))
    .limit(1);

  return fallback ?? null;
}
