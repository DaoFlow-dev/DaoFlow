import { eq } from "drizzle-orm";
import type { ComposeBuildPlan } from "../../compose-build-plan";
import type { ComposePreviewMetadata, ComposePreviewRequestInput } from "../../compose-preview";
import type { ComposeReadinessProbe } from "../../compose-readiness";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";
import { buildComposeDeploymentPlanDetails } from "./deployment-plan-compose";
import { makePlanCheck } from "./deployment-plan-checks";
import {
  normalizeDeploymentPlanSourceType,
  resolveTargetServer
} from "./deployment-plan-preflight";
import { buildDeploymentPlanSteps } from "./deployment-plan-steps";
import { formatCurrentDeployment, readLatestDeploymentForService } from "./deployment-plan-targets";
import { asRecord } from "./json-helpers";
import { resolveServiceForUser } from "./scoped-services";

type ComposeEnvPlanDiagnostics = ReturnType<
  typeof import("../../compose-env-plan").buildComposeEnvPlanDiagnostics
>;
type NormalizedComposePreviewRequest = ReturnType<
  typeof import("../../compose-preview").normalizeComposePreviewRequest
>;

export interface BuildDeploymentPlanInput {
  serviceRef: string;
  serverRef?: string;
  imageTag?: string;
  preview?: ComposePreviewRequestInput;
  requestedByUserId: string;
}

export async function buildDeploymentPlan(input: BuildDeploymentPlanInput) {
  const service = await resolveServiceForUser(input.serviceRef, input.requestedByUserId);
  const [projectRows, environmentRows] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, service.projectId)).limit(1),
    db.select().from(environments).where(eq(environments.id, service.environmentId)).limit(1)
  ]);

  const project = projectRows[0];
  const environment = environmentRows[0];

  if (!project || !environment) {
    throw new Error(`Service "${service.name}" is missing its project or environment linkage.`);
  }

  const environmentConfig = asRecord(environment.config);
  const environmentTargetServerId =
    typeof environmentConfig.targetServerId === "string" ? environmentConfig.targetServerId : null;
  const configuredTargetServerId = service.targetServerId ?? environmentTargetServerId;
  const configuredServer = await resolveTargetServer(undefined, configuredTargetServerId);
  const resolvedServer = input.serverRef
    ? await resolveTargetServer(input.serverRef, null)
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
  const latestDeployment = await readLatestDeploymentForService({
    environmentId: service.environmentId,
    serviceName: service.name
  });
  const sourceType = normalizeDeploymentPlanSourceType(service.sourceType);
  let composeEnvPlan: ComposeEnvPlanDiagnostics | null = null;
  let composeBuildPlan: ComposeBuildPlan | null = null;
  let previewRequest: NormalizedComposePreviewRequest | null = null;
  let previewMetadata: ComposePreviewMetadata | null = null;
  let composeOperation: "up" | "down" = "up";
  let readinessProbe: ComposeReadinessProbe | null = null;

  const checks = [
    makePlanCheck("ok", `Service ${service.name} is registered in ${environment.name}.`),
    resolvedServer
      ? makePlanCheck(
          "ok",
          `Target server resolved to ${resolvedServer.name} (${resolvedServer.host}) as ${resolvedServer.kind}.`
        )
      : makePlanCheck("fail", "No target server is configured for this service or environment."),
    sourceType === "dockerfile" && !service.dockerfilePath
      ? makePlanCheck(
          "warn",
          "Dockerfile path is not set; the worker will fall back to the default."
        )
      : makePlanCheck("ok", `Source type is ${sourceType}.`),
    effectiveImageTag
      ? makePlanCheck("ok", `Deployment input will use ${effectiveImageTag}.`)
      : makePlanCheck(
          "warn",
          "No explicit image reference is configured; execution must derive one."
        )
  ];

  if (input.preview && sourceType !== "compose") {
    checks.push(
      makePlanCheck("fail", "Preview deployments are only supported for compose services.")
    );
  }

  if (sourceType === "compose") {
    const composePlan = await buildComposeDeploymentPlanDetails({
      service,
      project,
      environment,
      resolvedServer,
      effectiveImageTag,
      latestDeploymentEnvVarsEncrypted: latestDeployment?.envVarsEncrypted ?? null,
      previewInput: input.preview
    });

    checks.push(...composePlan.checks);
    composeEnvPlan = composePlan.composeEnvPlan;
    composeBuildPlan = composePlan.composeBuildPlan;
    previewRequest = composePlan.previewRequest;
    previewMetadata = composePlan.previewMetadata;
    composeOperation = composePlan.composeOperation;
    readinessProbe = composePlan.readinessProbe;
  }

  const steps = buildDeploymentPlanSteps({
    sourceType,
    imageTag: effectiveImageTag,
    hasDockerfilePath: Boolean(service.dockerfilePath),
    hasHealthcheck: Boolean(service.healthcheckPath),
    targetServerName: resolvedServer?.name ?? "the configured worker",
    targetServerKind: resolvedServer?.kind,
    stackName: previewMetadata?.stackName ?? project.name,
    composeServiceName: service.composeServiceName,
    composeReadinessProbe: readinessProbe,
    composeBuildPlan,
    composeOperation
  });
  const currentDeployment = formatCurrentDeployment(latestDeployment);

  return {
    isReady: checks.every((check) => check.status !== "fail"),
    service: {
      id: service.id,
      name: service.name,
      sourceType,
      projectId: project.id,
      projectName: project.name,
      environmentId: environment.id,
      environmentName: environment.name,
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
      targetKind: resolvedServer?.kind ?? null,
      imageTag: effectiveImageTag,
      preview: previewMetadata
    },
    currentDeployment,
    preflightChecks: checks,
    steps,
    executeCommand: [
      "daoflow deploy",
      `--service ${service.id}`,
      resolvedServer ? `--server ${resolvedServer.id}` : null,
      effectiveImageTag ? `--image ${effectiveImageTag}` : null,
      previewRequest ? `--preview-branch ${previewRequest.branch}` : null,
      typeof previewRequest?.pullRequestNumber === "number"
        ? `--preview-pr ${previewRequest.pullRequestNumber}`
        : null,
      composeOperation === "down" ? "--preview-close" : null,
      "--yes"
    ]
      .filter(Boolean)
      .join(" ")
  };
}
