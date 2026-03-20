import { and, desc, eq } from "drizzle-orm";
import {
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import {
  describeComposeReadinessProbe,
  readComposeReadinessProbeFromConfig,
  type ComposeReadinessProbe
} from "../../compose-readiness";
import type { ComposeBuildPlan } from "../../compose-build-plan";
import { resolveComposeExecutionScope } from "../../compose-build-plan-execution";
import { buildComposeEnvPlanDiagnostics } from "../../compose-env-plan";
import { materializeComposeWorkspaceArtifacts } from "../../compose-workspace-artifacts";
import {
  hasServiceRuntimeConfig,
  readServiceRuntimeConfig,
  readServiceRuntimeConfigFromConfig
} from "../../service-runtime-config";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { asRecord } from "./json-helpers";
import { resolveComposeDeploymentEnvEntries } from "./compose-env";
import {
  resolveComposeFilePaths,
  resolveComposeImageOverride,
  resolveComposeProfiles
} from "./deployment-source";
import { materializeProjectSourceInspection } from "./project-source-checkout-inspection";
import { resolveServiceForUser } from "./scoped-services";

type PlanCheckStatus = "ok" | "warn" | "fail";
type DeploymentPlanSourceType = "compose" | "dockerfile" | "image";

function makeCheck(status: PlanCheckStatus, detail: string) {
  return { status, detail };
}

function summarizeComposeEnvPlanDiagnostics(input: {
  branch: string;
  diagnostics: ReturnType<typeof buildComposeEnvPlanDiagnostics>;
}) {
  const { diagnostics } = input;
  const variableLabel =
    diagnostics.composeEnv.counts.environmentVariables === 1 ? "variable" : "variables";
  const branchScopedLabel =
    diagnostics.matchedBranchOverrideCount === 1 ? "branch-scoped match" : "branch-scoped matches";

  return `Compose env plan resolved ${diagnostics.composeEnv.counts.total} entries for branch ${input.branch}: ${diagnostics.composeEnv.counts.repoDefaults} repo defaults, ${diagnostics.composeEnv.counts.environmentVariables} DaoFlow-managed ${variableLabel}, ${diagnostics.composeEnv.counts.overriddenRepoDefaults} repo-default overrides, ${diagnostics.matchedBranchOverrideCount} ${branchScopedLabel}.`;
}

function buildComposeEnvPlanChecks(
  diagnostics: ReturnType<typeof buildComposeEnvPlanDiagnostics>
): Array<{ status: PlanCheckStatus; detail: string }> {
  const checks: Array<{ status: PlanCheckStatus; detail: string }> = [
    makeCheck("ok", summarizeComposeEnvPlanDiagnostics({ branch: diagnostics.branch, diagnostics }))
  ];

  for (const warning of diagnostics.interpolation.warnings) {
    checks.push(makeCheck("warn", warning));
  }

  for (const issue of diagnostics.interpolation.unresolved) {
    checks.push(makeCheck(issue.severity, issue.detail));
  }

  if (diagnostics.interpolation.status === "ok") {
    checks.push(
      makeCheck(
        "ok",
        `Compose interpolation analysis found ${diagnostics.interpolation.summary.totalReferences} references with no unresolved variables.`
      )
    );
  } else if (diagnostics.interpolation.status === "warn") {
    checks.push(
      makeCheck(
        "warn",
        `Compose interpolation analysis found ${diagnostics.interpolation.summary.optionalMissing} unresolved optional references.`
      )
    );
  } else if (diagnostics.interpolation.status === "unavailable") {
    checks.push(
      makeCheck(
        "warn",
        "Compose interpolation analysis is unavailable for this plan; only env precedence diagnostics are shown."
      )
    );
  }

  return checks;
}

function hasRepositorySource(project: typeof projects.$inferSelect): boolean {
  return Boolean(
    project.repoUrl || (project.repoFullName && project.gitProviderId && project.gitInstallationId)
  );
}

async function materializeComposePlanningPreflight(input: {
  project: typeof projects.$inferSelect;
  environment: typeof environments.$inferSelect;
  branch: string;
  imageTag: string | null;
  serviceName: string;
  composeServiceName?: string | null;
  serviceImageReference?: string | null;
  runtimeConfig?: unknown;
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
    const composeFilePaths = resolveComposeFilePaths({
      project: input.project,
      environment: input.environment
    });
    const composeProfiles = resolveComposeProfiles({
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
      composeFiles: composeFilePaths,
      composeProfiles,
      branch: input.branch,
      sourceProvenance: "repository-checkout",
      deploymentState: { envState: { kind: "queued", entries: [] } },
      imageOverride: composeImageOverride,
      runtimeConfig: readServiceRuntimeConfig(input.runtimeConfig),
      composeServiceName: input.composeServiceName
    });

    const renderedCompose = materialized.composeInputs.frozenInputs.renderedCompose;
    if (!renderedCompose) {
      throw new Error("Compose planning did not produce a rendered compose snapshot.");
    }

    return {
      status: "ok",
      composeContent: renderedCompose.contents,
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

function normalizeSourceType(value: string): DeploymentPlanSourceType {
  if (value === "dockerfile" || value === "image") {
    return value;
  }

  return "compose";
}

async function resolveServer(serverRef: string | undefined, fallbackServerId: string | null) {
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

function buildPlanSteps(input: {
  sourceType: "compose" | "dockerfile" | "image";
  imageTag: string | null;
  hasDockerfilePath: boolean;
  hasHealthcheck: boolean;
  targetServerName: string;
  composeServiceName?: string | null;
  composeReadinessProbe?: ComposeReadinessProbe | null;
  composeBuildPlan?: ComposeBuildPlan | null;
}) {
  const serverStep = `Dispatch execution to ${input.targetServerName}`;

  switch (input.sourceType) {
    case "compose": {
      const executionScope = input.composeBuildPlan
        ? resolveComposeExecutionScope(input.composeBuildPlan, input.composeServiceName)
        : null;
      const composeTargetLabel = input.composeServiceName
        ? `compose service ${input.composeServiceName}`
        : "compose services";
      const composeUpCommand = input.composeServiceName
        ? `Apply docker compose up -d ${input.composeServiceName} with the staged configuration`
        : "Apply docker compose up -d with the staged configuration";
      const steps = ["Freeze the compose inputs and resolved runtime spec"];
      if (executionScope?.needsPull ?? true) {
        steps.push(
          input.imageTag
            ? `Pull ${input.imageTag} and refresh ${composeTargetLabel}`
            : `Resolve image references from the compose spec and refresh ${composeTargetLabel}`
        );
      }
      if ((executionScope?.buildServiceNames.length ?? 0) > 0) {
        steps.push(`Build ${composeTargetLabel} from the checked-out compose contexts`);
      }
      steps.push(
        composeUpCommand,
        input.composeReadinessProbe
          ? `Verify Docker Compose container state, Docker health, and ${describeComposeReadinessProbe(input.composeReadinessProbe)}, then mark the rollout outcome`
          : "Verify Docker Compose container state and Docker health, then mark the rollout outcome",
        serverStep
      );
      return steps;
    }
    case "dockerfile":
      return [
        "Freeze Dockerfile inputs and build context",
        input.hasDockerfilePath
          ? "Build the image from the configured Dockerfile"
          : "Build the image using the default Dockerfile path",
        "Replace the running container with the new image",
        input.hasHealthcheck
          ? "Run configured health check and promote only if it stays green"
          : "Verify container status and Docker health, then mark the rollout outcome",
        serverStep
      ];
    case "image":
    default:
      return [
        `Pull ${input.imageTag ?? "the configured image reference"}`,
        "Stop the existing container and start the new image",
        input.hasHealthcheck
          ? "Run configured health check and promote only if it stays green"
          : "Verify container status and Docker health, then mark the rollout outcome",
        serverStep
      ];
  }
}

export interface BuildDeploymentPlanInput {
  serviceRef: string;
  serverRef?: string;
  imageTag?: string;
  requestedByUserId: string;
}

export async function buildDeploymentPlan(input: BuildDeploymentPlanInput) {
  const service = await resolveServiceForUser(input.serviceRef, input.requestedByUserId);
  const [project, environment] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, service.projectId)).limit(1),
    db.select().from(environments).where(eq(environments.id, service.environmentId)).limit(1)
  ]);

  if (!project[0] || !environment[0]) {
    throw new Error(`Service "${service.name}" is missing its project or environment linkage.`);
  }

  const environmentConfig = asRecord(environment[0].config);
  const environmentTargetServerId =
    typeof environmentConfig.targetServerId === "string" ? environmentConfig.targetServerId : null;
  const configuredTargetServerId = service.targetServerId ?? environmentTargetServerId;
  const configuredServer = await resolveServer(undefined, configuredTargetServerId);
  const resolvedServer = input.serverRef
    ? await resolveServer(input.serverRef, null)
    : configuredServer;

  if (input.serverRef) {
    if (!configuredTargetServerId) {
      throw new Error(
        "This service does not have a configured target server. Set the service or environment target first."
      );
    }

    if (!resolvedServer || resolvedServer.id !== configuredTargetServerId) {
      throw new Error("Requested server does not match this service's configured target.");
    }
  }

  const effectiveImageTag = input.imageTag?.trim() || service.imageReference || null;

  const [latestDeployment] = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.environmentId, service.environmentId),
        eq(deployments.serviceName, service.name)
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  const sourceType = normalizeSourceType(service.sourceType);
  const readinessProbe = readComposeReadinessProbeFromConfig(service.config);
  const runtimeConfig = readServiceRuntimeConfigFromConfig(service.config);
  let composeEnvPlan: ReturnType<typeof buildComposeEnvPlanDiagnostics> | null = null;
  let composeBuildPlan: ComposeBuildPlan | null = null;

  const checks = [
    makeCheck("ok", `Service ${service.name} is registered in ${environment[0].name}.`),
    resolvedServer
      ? makeCheck(
          "ok",
          `Target server resolved to ${resolvedServer.name} (${resolvedServer.host}).`
        )
      : makeCheck("fail", "No target server is configured for this service or environment."),
    sourceType === "dockerfile" && !service.dockerfilePath
      ? makeCheck("warn", "Dockerfile path is not set; the worker will fall back to the default.")
      : makeCheck("ok", `Source type is ${sourceType}.`),
    effectiveImageTag
      ? makeCheck("ok", `Deployment input will use ${effectiveImageTag}.`)
      : makeCheck("warn", "No explicit image reference is configured; execution must derive one.")
  ];

  if (sourceType === "compose") {
    if (readinessProbe) {
      checks.push(
        makeCheck(
          "ok",
          `Compose execution will run ${describeComposeReadinessProbe(readinessProbe)} after Docker Compose container state and Docker health are green.`
        )
      );
    }

    if (hasServiceRuntimeConfig(runtimeConfig)) {
      checks.push(
        makeCheck(
          "ok",
          `DaoFlow-managed runtime overrides will merge into ${service.composeServiceName ?? service.name} before the compose stack is rendered.`
        )
      );
    }

    if (!readinessProbe && service.healthcheckPath) {
      checks.push(
        makeCheck(
          "warn",
          `Compose service healthcheckPath "${service.healthcheckPath}" is advisory only today; compose execution verifies Docker Compose container state and Docker health instead of probing that path.`
        )
      );
    }

    if (readinessProbe && service.healthcheckPath) {
      checks.push(
        makeCheck(
          "warn",
          `Legacy healthcheckPath "${service.healthcheckPath}" is ignored for compose execution because an explicit readiness probe is configured.`
        )
      );
    }

    const branch = project[0].defaultBranch ?? "main";
    const deploymentEntries = await resolveComposeDeploymentEnvEntries({
      environmentId: environment[0].id,
      branch
    });
    const repoBacked = hasRepositorySource(project[0]);

    if (repoBacked) {
      const planInputs = await materializeComposePlanningPreflight({
        project: project[0],
        environment: environment[0],
        branch,
        imageTag: effectiveImageTag,
        serviceName: service.name,
        composeServiceName: service.composeServiceName,
        serviceImageReference: service.imageReference,
        runtimeConfig
      });

      if (planInputs.status === "ok") {
        composeBuildPlan = planInputs.buildPlan;
        composeEnvPlan = buildComposeEnvPlanDiagnostics({
          branch,
          composeContent: planInputs.composeContent,
          repoDefaultContent: planInputs.repoDefaultContent,
          deploymentEntries,
          warnings: planInputs.warnings
        });
        checks.push(...buildComposeEnvPlanChecks(composeEnvPlan));
        if (composeBuildPlan.services.length > 0) {
          const buildServiceLabel = composeBuildPlan.services.length === 1 ? "service" : "services";
          checks.push(
            makeCheck(
              "ok",
              `Compose build plan detected ${composeBuildPlan.services.length} build ${buildServiceLabel}: ${composeBuildPlan.services.map((buildService) => buildService.serviceName).join(", ")}.`
            )
          );
        }
      } else {
        checks.push(makeCheck("fail", `Compose workspace preflight failed: ${planInputs.reason}`));
      }
    } else {
      composeEnvPlan = buildComposeEnvPlanDiagnostics({
        branch,
        deploymentEntries,
        warnings: [
          "Compose workspace preflight requires a repository-backed source; this service relies on uploaded artifacts or replayable deployment state."
        ]
      });
      checks.push(...buildComposeEnvPlanChecks(composeEnvPlan));
    }
  }

  const steps = buildPlanSteps({
    sourceType,
    imageTag: effectiveImageTag,
    hasDockerfilePath: Boolean(service.dockerfilePath),
    hasHealthcheck: Boolean(service.healthcheckPath),
    targetServerName: resolvedServer?.name ?? "the configured worker",
    composeServiceName: service.composeServiceName,
    composeReadinessProbe: readinessProbe,
    composeBuildPlan
  });

  const currentDeployment = latestDeployment
    ? {
        id: latestDeployment.id,
        status: normalizeDeploymentStatus(latestDeployment.status, latestDeployment.conclusion),
        statusLabel: formatDeploymentStatusLabel(
          latestDeployment.status,
          latestDeployment.conclusion
        ),
        statusTone: getDeploymentStatusTone(latestDeployment.status, latestDeployment.conclusion),
        imageTag: latestDeployment.imageTag,
        commitSha: latestDeployment.commitSha,
        createdAt: latestDeployment.createdAt.toISOString(),
        finishedAt: latestDeployment.concludedAt?.toISOString() ?? null
      }
    : null;

  return {
    isReady: checks.every((check) => check.status !== "fail"),
    service: {
      id: service.id,
      name: service.name,
      sourceType,
      projectId: project[0].id,
      projectName: project[0].name,
      environmentId: environment[0].id,
      environmentName: environment[0].name,
      imageReference: service.imageReference,
      dockerfilePath: service.dockerfilePath,
      composeServiceName: service.composeServiceName,
      healthcheckPath: service.healthcheckPath,
      readinessProbe
    },
    composeEnvPlan,
    target: {
      serverId: resolvedServer?.id ?? null,
      serverName: resolvedServer?.name ?? null,
      serverHost: resolvedServer?.host ?? null,
      imageTag: effectiveImageTag
    },
    currentDeployment,
    preflightChecks: checks,
    steps,
    executeCommand: [
      "daoflow deploy",
      `--service ${service.id}`,
      resolvedServer ? `--server ${resolvedServer.id}` : null,
      effectiveImageTag ? `--image ${effectiveImageTag}` : null,
      "--yes"
    ]
      .filter(Boolean)
      .join(" ")
  };
}
