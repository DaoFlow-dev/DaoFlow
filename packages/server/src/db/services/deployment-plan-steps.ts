import type { ComposeBuildPlan } from "../../compose-build-plan";
import { resolveComposeExecutionScope } from "../../compose-build-plan-execution";
import { describeComposeReadinessProbe, type ComposeReadinessProbe } from "../../compose-readiness";
import type { DeploymentPlanSourceType } from "./deployment-plan-preflight";

export function buildDeploymentPlanSteps(input: {
  sourceType: DeploymentPlanSourceType;
  imageTag: string | null;
  hasDockerfilePath: boolean;
  hasHealthcheck: boolean;
  targetServerName: string;
  targetServerKind?: string | null;
  stackName?: string | null;
  composeServiceName?: string | null;
  composeReadinessProbe?: ComposeReadinessProbe | null;
  composeBuildPlan?: ComposeBuildPlan | null;
  composeOperation?: "up" | "down";
}) {
  const serverStep = `Dispatch execution to ${input.targetServerName}`;

  switch (input.sourceType) {
    case "compose": {
      const isSwarmManager = input.targetServerKind === "docker-swarm-manager";
      const stackName = input.stackName?.trim() || "the staged stack";
      if (input.composeOperation === "down") {
        return [
          "Freeze the compose inputs and resolved runtime spec for preview cleanup",
          isSwarmManager
            ? `Apply docker stack rm for preview stack ${stackName}`
            : "Apply docker compose down for the preview stack",
          serverStep
        ];
      }

      const executionScope = input.composeBuildPlan
        ? resolveComposeExecutionScope(input.composeBuildPlan, input.composeServiceName)
        : null;
      const hasScopedBuildServices = (executionScope?.buildServiceNames.length ?? 0) > 0;
      const needsPull = executionScope?.needsPull ?? true;
      const composeTargetLabel = input.composeServiceName
        ? `compose service ${input.composeServiceName}`
        : "compose services";
      const composeUpCommand = input.composeServiceName
        ? `Apply docker compose up -d ${input.composeServiceName} with the staged configuration`
        : "Apply docker compose up -d with the staged configuration";
      const steps = ["Freeze the compose inputs and resolved runtime spec"];
      if (needsPull) {
        steps.push(
          input.imageTag
            ? `Pull ${input.imageTag} and refresh ${composeTargetLabel}`
            : `Resolve image references from the compose spec and refresh ${composeTargetLabel}`
        );
      }
      if (hasScopedBuildServices) {
        steps.push(`Build ${composeTargetLabel} from the checked-out compose contexts`);
      }
      steps.push(
        isSwarmManager
          ? `Apply docker stack deploy for ${stackName} with the staged configuration`
          : composeUpCommand
      );
      steps.push(
        isSwarmManager
          ? input.composeReadinessProbe
            ? `Verify Docker Swarm service replicas, running tasks, and ${describeComposeReadinessProbe(input.composeReadinessProbe, input.composeServiceName ?? undefined)}, then mark the rollout outcome`
            : "Verify Docker Swarm service replicas and running tasks, then mark the rollout outcome"
          : input.composeReadinessProbe
            ? `Verify Docker Compose container state, Docker health, and ${describeComposeReadinessProbe(input.composeReadinessProbe, input.composeServiceName ?? undefined)}, then mark the rollout outcome`
            : "Verify Docker Compose container state and Docker health, then mark the rollout outcome"
      );
      steps.push(serverStep);
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
