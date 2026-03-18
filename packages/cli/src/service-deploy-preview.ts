import { emitJsonSuccess } from "./command-helpers";
import { printDeploymentPlan, type DeploymentPlanPreview } from "./deployment-plan-output";

export interface DeploymentPlanClientLike {
  deploymentPlan: {
    query(input: {
      service: string;
      server?: string;
      image?: string;
    }): Promise<DeploymentPlanPreview>;
  };
}

export interface PreviewServiceDeployOptions {
  serviceId: string;
  serverId?: string;
  imageTag?: string;
  json?: boolean;
}

export async function previewServiceDeploy(
  trpc: DeploymentPlanClientLike,
  options: PreviewServiceDeployOptions
): Promise<void> {
  const plan = await trpc.deploymentPlan.query({
    service: options.serviceId,
    server: options.serverId,
    image: options.imageTag
  });

  if (options.json) {
    emitJsonSuccess({ dryRun: true, plan });
    return;
  }

  printDeploymentPlan(plan, { subtitle: "This plan will NOT be executed." });
}
