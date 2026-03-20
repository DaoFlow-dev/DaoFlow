import { emitJsonSuccess } from "./command-helpers";
import { printDeploymentPlan, type DeploymentPlanPreview } from "./deployment-plan-output";

export interface DeploymentPlanClientLike {
  deploymentPlan: {
    query(input: {
      service: string;
      server?: string;
      image?: string;
      preview?: {
        target: "branch" | "pull-request";
        branch: string;
        pullRequestNumber?: number;
        action?: "deploy" | "destroy";
      };
    }): Promise<DeploymentPlanPreview>;
  };
}

export interface PreviewServiceDeployOptions {
  serviceId: string;
  serverId?: string;
  imageTag?: string;
  preview?: {
    target: "branch" | "pull-request";
    branch: string;
    pullRequestNumber?: number;
    action?: "deploy" | "destroy";
  };
  json?: boolean;
}

export async function previewServiceDeploy(
  trpc: DeploymentPlanClientLike,
  options: PreviewServiceDeployOptions
): Promise<void> {
  const plan = await trpc.deploymentPlan.query({
    service: options.serviceId,
    server: options.serverId,
    image: options.imageTag,
    preview: options.preview
  });

  if (options.json) {
    emitJsonSuccess({ dryRun: true, plan });
    return;
  }

  printDeploymentPlan(plan, { subtitle: "This plan will NOT be executed." });
}
