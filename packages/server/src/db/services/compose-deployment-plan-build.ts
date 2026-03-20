import { isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import { buildComposeBuildPlan, type ComposeBuildPlan } from "../../compose-build-plan";
import { resolveComposeExecutionScope } from "../../compose-build-plan-execution";

export interface DirectComposeLocalBuildContext {
  serviceName: string;
  context: string;
  dockerfile: string | null;
}

export function deriveLocalBuildContexts(
  buildPlan: ComposeBuildPlan
): DirectComposeLocalBuildContext[] {
  return buildPlan.services
    .filter((service) => service.contextType === "local-path")
    .map((service) => ({
      serviceName: service.serviceName,
      context: service.context,
      dockerfile: service.dockerfile
    }));
}

function isBundleableLocalPath(value: string): boolean {
  if (isAbsolute(value)) {
    return false;
  }

  return value === "." || value.startsWith("./") || value.startsWith("../") || !value.includes(":");
}

export function hasComposeBuildServices(buildPlan: ComposeBuildPlan): boolean {
  return buildPlan.services.length > 0;
}

export function summarizeComposeGraph(buildPlan: ComposeBuildPlan): string {
  const serviceLabel = buildPlan.graphServices.length === 1 ? "service" : "services";
  const networkLabel = buildPlan.networks.length === 1 ? "network" : "networks";
  const volumeLabel = buildPlan.volumes.length === 1 ? "named volume" : "named volumes";
  const secretLabel = buildPlan.secrets.length === 1 ? "secret" : "secrets";
  const configLabel = buildPlan.configs.length === 1 ? "config" : "configs";

  return `Compose graph normalized ${buildPlan.graphServices.length} ${serviceLabel}, ${buildPlan.networks.length} ${networkLabel}, ${buildPlan.volumes.length} ${volumeLabel}, ${buildPlan.secrets.length} ${secretLabel}, and ${buildPlan.configs.length} ${configLabel}.`;
}

export function deriveComposeStackName(buildPlan: ComposeBuildPlan, fallback: string): string {
  return buildPlan.stackName?.trim() || buildPlan.graphServices[0]?.serviceName?.trim() || fallback;
}

export function hasBundleableBuildInputs(buildPlan: ComposeBuildPlan): boolean {
  return buildPlan.services.some(
    (service) =>
      isBundleableLocalPath(service.context) ||
      service.additionalContexts.some(
        (additionalContext) =>
          additionalContext.type === "local-path" && isBundleableLocalPath(additionalContext.value)
      ) ||
      service.secrets.some(
        (secret) =>
          secret.provider === "file" &&
          typeof secret.reference === "string" &&
          isBundleableLocalPath(secret.reference)
      )
  );
}

export function canonicalizeLocalBuildContexts(
  contexts: Array<{
    serviceName: string;
    context: string;
    dockerfile?: string | null;
  }>
): string[] {
  return contexts
    .map(
      (context) => `${context.serviceName}\u0000${context.context}\u0000${context.dockerfile ?? ""}`
    )
    .sort((a, b) => a.localeCompare(b));
}

export function buildComposePlanSteps(input: {
  requiresContextUpload: boolean;
  buildPlan: ComposeBuildPlan;
  targetServerName: string;
  composeServiceName?: string | null;
}) {
  const hasBundleableLocalBuildInputs = hasBundleableBuildInputs(input.buildPlan);
  const executionScope = resolveComposeExecutionScope(input.buildPlan, input.composeServiceName);
  const hasBuildServices = executionScope.buildServiceNames.length > 0;
  const needsPull = executionScope.needsPull;

  if (input.requiresContextUpload) {
    const steps = hasBundleableLocalBuildInputs
      ? [
          "Freeze the compose file and local build-context manifest",
          "Bundle the local build context while respecting .dockerignore rules",
          "Upload the staged archive and compose file to the DaoFlow control plane",
          "Dispatch the uploaded compose workspace to the execution plane"
        ]
      : [
          "Freeze the compose file and local deployment-input manifest",
          "Bundle the required local deployment inputs for upload",
          "Upload the staged archive and compose file to the DaoFlow control plane",
          "Dispatch the uploaded compose workspace to the execution plane"
        ];

    if (needsPull) {
      steps.push(`Pull compose images on ${input.targetServerName}`);
    }

    if (hasBuildServices) {
      steps.push(`Build staged compose services on ${input.targetServerName}`);
    }

    steps.push(`Run docker compose up -d on ${input.targetServerName}`);
    steps.push("Record health checks and the final deployment outcome");
    return steps;
  }

  const steps = [
    "Freeze the compose file for an immutable deployment record",
    "Stage the compose file in durable control-plane storage",
    "Dispatch the compose deployment to the execution plane"
  ];

  if (needsPull) {
    steps.push(`Pull compose images on ${input.targetServerName}`);
  }

  if (hasBuildServices) {
    steps.push(`Build staged compose services on ${input.targetServerName}`);
  }

  steps.push(`Run docker compose up -d on ${input.targetServerName}`);
  steps.push("Record health checks and the final deployment outcome");
  return steps;
}

export function parseComposeBuildPlan(composeContent: string): ComposeBuildPlan {
  const doc = (parseYaml(composeContent) as Record<string, unknown> | null) ?? {};
  return buildComposeBuildPlan(doc);
}

export function summarizeDerivedBuildPlan(buildPlan: ComposeBuildPlan): string {
  if (!hasComposeBuildServices(buildPlan)) {
    return "Server-side compose analysis detected no compose build services.";
  }

  const buildServiceLabel = buildPlan.services.length === 1 ? "service" : "services";
  const serviceList = buildPlan.services.map((service) => service.serviceName).join(", ");
  return hasBundleableBuildInputs(buildPlan)
    ? `Server-side compose analysis detected ${buildPlan.services.length} compose build ${buildServiceLabel} with local build inputs that require upload: ${serviceList}.`
    : `Server-side compose analysis detected ${buildPlan.services.length} compose build ${buildServiceLabel} that can build without local upload: ${serviceList}.`;
}
