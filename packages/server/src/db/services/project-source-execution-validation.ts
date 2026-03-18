import { eq } from "drizzle-orm";
import { db } from "../connection";
import { projects } from "../schema/projects";
import { resolveComposeFilePath } from "./deployment-source";
import {
  mergeProjectSourceReadiness,
  validateProjectSourceReadiness,
  type ProjectSourceReadiness
} from "./project-source-readiness";

type ProjectExecutionValidationProject = Pick<
  typeof projects.$inferSelect,
  | "id"
  | "repoFullName"
  | "repoUrl"
  | "gitProviderId"
  | "gitInstallationId"
  | "defaultBranch"
  | "composePath"
  | "config"
>;

type ProjectExecutionValidationEnvironment = {
  config: unknown;
} | null;

export type ProjectSourceExecutionValidationResult =
  | {
      status: "ready";
      readiness: ProjectSourceReadiness;
      config: Record<string, unknown>;
    }
  | {
      status: "invalid_source";
      message: string;
      readiness: ProjectSourceReadiness | null;
      config: Record<string, unknown>;
    }
  | {
      status: "skipped";
    };

export async function revalidateProjectSourceForExecution(input: {
  project: ProjectExecutionValidationProject;
  environment?: ProjectExecutionValidationEnvironment;
}): Promise<ProjectSourceExecutionValidationResult> {
  const validation = await validateProjectSourceReadiness({
    repoFullName: input.project.repoFullName,
    gitProviderId: input.project.gitProviderId,
    gitInstallationId: input.project.gitInstallationId,
    defaultBranch: input.project.defaultBranch,
    composePath: resolveComposeFilePath({
      project: input.project,
      environment: input.environment
    })
  });

  if (validation.status === "skipped") {
    return validation;
  }

  const readiness = validation.readiness;
  const config = mergeProjectSourceReadiness(input.project.config, readiness ?? null);

  await db
    .update(projects)
    .set({
      config,
      updatedAt: new Date()
    })
    .where(eq(projects.id, input.project.id));

  if (validation.status === "ready") {
    return {
      status: "ready",
      readiness: validation.readiness,
      config
    };
  }

  return {
    status: "invalid_source",
    message: validation.message,
    readiness: validation.readiness,
    config
  };
}
