import type { ComposeBuildPlan } from "../../compose-build-plan";
import { resolveComposeExecutionScope } from "../../compose-build-plan-execution";
import { buildComposeEnvPlanDiagnostics } from "../../compose-env-plan";
import {
  buildComposePreviewEnvEntries,
  deriveComposePreviewMetadata,
  normalizeComposePreviewRequest,
  previewModeAllowsRequest,
  readComposePreviewConfigFromConfig,
  type ComposePreviewMetadata,
  type ComposePreviewRequestInput
} from "../../compose-preview";
import {
  describeComposeReadinessProbe,
  readComposeReadinessProbeFromConfig,
  type ComposeReadinessProbe
} from "../../compose-readiness";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { readDeploymentComposeState, resolveComposeDeploymentEnvEntries } from "./compose-env";
import { summarizeComposeGraph } from "./compose-deployment-plan-build";
import { buildComposeEnvPlanChecks, makePlanCheck, type PlanCheck } from "./deployment-plan-checks";
import {
  hasRepositorySource,
  materializeComposePlanningPreflight
} from "./deployment-plan-preflight";

function readReplayableComposePlanSource(envVarsEncrypted: string | null | undefined): {
  composeContent: string | null;
  warnings: string[];
} {
  if (!envVarsEncrypted) {
    return { composeContent: null, warnings: [] };
  }

  try {
    return {
      composeContent:
        readDeploymentComposeState(envVarsEncrypted).frozenInputs?.composeFile.contents ?? null,
      warnings: []
    };
  } catch {
    return {
      composeContent: null,
      warnings: [
        "DaoFlow could not recover replayable compose source from the latest deployment state."
      ]
    };
  }
}

export async function buildComposeDeploymentPlanDetails(input: {
  service: typeof services.$inferSelect;
  project: typeof projects.$inferSelect;
  environment: typeof environments.$inferSelect;
  resolvedServer: typeof servers.$inferSelect | null;
  effectiveImageTag: string | null;
  latestDeploymentEnvVarsEncrypted?: string | null;
  previewInput?: ComposePreviewRequestInput;
}): Promise<{
  checks: PlanCheck[];
  composeEnvPlan: ReturnType<typeof buildComposeEnvPlanDiagnostics> | null;
  composeBuildPlan: ComposeBuildPlan | null;
  previewRequest: ReturnType<typeof normalizeComposePreviewRequest> | null;
  previewMetadata: ComposePreviewMetadata | null;
  composeOperation: "up" | "down";
  readinessProbe: ComposeReadinessProbe | null;
}> {
  const checks: PlanCheck[] = [];
  const readinessProbe = readComposeReadinessProbeFromConfig(input.service.config);
  const previewConfig = readComposePreviewConfigFromConfig(input.service.config);
  const previewRequest = input.previewInput
    ? normalizeComposePreviewRequest(input.previewInput)
    : null;
  let previewMetadata: ComposePreviewMetadata | null = null;
  let composeEnvPlan: ReturnType<typeof buildComposeEnvPlanDiagnostics> | null = null;
  let composeBuildPlan: ComposeBuildPlan | null = null;
  const composeOperation = previewRequest?.action === "destroy" ? "down" : "up";
  const sourceBranch = previewRequest?.branch ?? input.project.defaultBranch ?? "main";

  if (previewRequest) {
    if (!previewConfig?.enabled) {
      checks.push(
        makePlanCheck("fail", "Preview deployments are not enabled for this compose service.")
      );
    } else if (!previewModeAllowsRequest(previewConfig.mode, previewRequest)) {
      checks.push(
        makePlanCheck(
          "fail",
          `Preview mode ${previewConfig.mode} does not allow ${previewRequest.target} preview requests.`
        )
      );
    } else {
      previewMetadata = deriveComposePreviewMetadata({
        config: previewConfig,
        request: previewRequest,
        projectName: input.project.name,
        environmentName: input.environment.name,
        serviceName: input.service.name,
        baseStackName: input.project.name
      });
      checks.push(
        makePlanCheck(
          "ok",
          `Preview ${previewMetadata.target} will use source branch ${previewMetadata.branch}, env branch ${previewMetadata.envBranch}, and isolated stack ${previewMetadata.stackName}.`
        )
      );
      if (previewMetadata.primaryDomain) {
        checks.push(
          makePlanCheck(
            "ok",
            `Preview domain mapping resolves to ${previewMetadata.primaryDomain}.`
          )
        );
      }
    }
  }

  if (readinessProbe) {
    checks.push(
      makePlanCheck(
        "ok",
        input.resolvedServer?.kind === "docker-swarm-manager"
          ? `Swarm execution will run ${describeComposeReadinessProbe(readinessProbe, input.service.composeServiceName ?? input.service.name)} after Docker Swarm service replicas and running tasks converge.`
          : `Compose execution will run ${describeComposeReadinessProbe(readinessProbe, input.service.composeServiceName ?? input.service.name)} after Docker Compose container state and Docker health are green.`
      )
    );
  } else if (input.service.healthcheckPath) {
    checks.push(
      makePlanCheck(
        "warn",
        `Compose service healthcheckPath "${input.service.healthcheckPath}" is advisory only today; compose execution verifies Docker Compose container state and Docker health instead of probing that path.`
      )
    );
  }

  if (readinessProbe && input.service.healthcheckPath) {
    checks.push(
      makePlanCheck(
        "warn",
        `Legacy healthcheckPath "${input.service.healthcheckPath}" is ignored for compose execution because an explicit readiness probe is configured.`
      )
    );
  }

  const deploymentEntries = await resolveComposeDeploymentEnvEntries({
    environmentId: input.environment.id,
    branch: previewMetadata?.envBranch ?? sourceBranch,
    additionalEntries:
      previewMetadata !== null ? buildComposePreviewEnvEntries(previewMetadata) : undefined
  });
  const repoBacked = hasRepositorySource(input.project);

  if (previewRequest && !repoBacked) {
    checks.push(
      makePlanCheck(
        "fail",
        "Preview deployments require a git-backed compose service so DaoFlow can check out the requested branch."
      )
    );
  }

  if (repoBacked) {
    const planInputs = await materializeComposePlanningPreflight({
      project: input.project,
      environment: input.environment,
      branch: sourceBranch,
      imageTag: input.effectiveImageTag,
      serviceName: input.service.name,
      composeServiceName: input.service.composeServiceName,
      serviceImageReference: input.service.imageReference
    });

    if (planInputs.status === "ok") {
      composeBuildPlan = planInputs.buildPlan;
      composeEnvPlan = buildComposeEnvPlanDiagnostics({
        branch: previewMetadata?.envBranch ?? sourceBranch,
        composeContent: planInputs.composeContent,
        repoDefaultContent: planInputs.repoDefaultContent,
        deploymentEntries,
        warnings: planInputs.warnings
      });
      checks.push(...buildComposeEnvPlanChecks(composeEnvPlan));
      checks.push(makePlanCheck("ok", summarizeComposeGraph(composeBuildPlan)));
      if (composeBuildPlan.services.length > 0) {
        const buildServiceLabel = composeBuildPlan.services.length === 1 ? "service" : "services";
        checks.push(
          makePlanCheck(
            "ok",
            `Compose build plan detected ${composeBuildPlan.services.length} build ${buildServiceLabel}: ${composeBuildPlan.services.map((buildService) => buildService.serviceName).join(", ")}.`
          )
        );
      } else {
        checks.push(
          makePlanCheck(
            "ok",
            "Compose build plan detected no local build contexts; execution will rely on pullable images."
          )
        );
      }
      const executionScope = resolveComposeExecutionScope(
        composeBuildPlan,
        input.service.composeServiceName
      );
      if (input.service.composeServiceName && executionScope.expectedServiceNames.length > 1) {
        checks.push(
          makePlanCheck(
            "ok",
            `Scoped compose execution for ${input.service.composeServiceName} also expects dependencies: ${executionScope.expectedServiceNames.filter((serviceName) => serviceName !== input.service.composeServiceName).join(", ")}.`
          )
        );
      }
      for (const warning of composeBuildPlan.warnings) {
        checks.push(makePlanCheck("warn", warning));
      }
    } else {
      checks.push(
        makePlanCheck("fail", `Compose workspace preflight failed: ${planInputs.reason}`)
      );
    }
  } else {
    const replayableComposeSource = readReplayableComposePlanSource(
      input.latestDeploymentEnvVarsEncrypted
    );
    composeEnvPlan = buildComposeEnvPlanDiagnostics({
      branch: previewMetadata?.envBranch ?? sourceBranch,
      composeContent: replayableComposeSource.composeContent,
      deploymentEntries,
      warnings: [
        "Compose workspace preflight requires a repository-backed source; this service relies on uploaded artifacts or replayable deployment state.",
        ...replayableComposeSource.warnings
      ]
    });
    checks.push(...buildComposeEnvPlanChecks(composeEnvPlan));
  }

  if (input.resolvedServer?.kind === "docker-swarm-manager") {
    checks.push(
      makePlanCheck(
        "ok",
        `Swarm manager targets reconcile the full stack ${previewMetadata?.stackName ?? input.project.name} with docker stack deploy semantics.`
      )
    );
  }

  return {
    checks,
    composeEnvPlan,
    composeBuildPlan,
    previewRequest,
    previewMetadata,
    composeOperation,
    readinessProbe
  };
}
