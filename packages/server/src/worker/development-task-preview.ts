import { eq } from "drizzle-orm";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { db } from "../db/connection";
import { services } from "../db/schema/services";
import { triggerDeploy, type TriggerDeployInput } from "../db/services/trigger-deploy";
import { asRecord } from "../db/services/json-helpers";
import { readComposePreviewConfigFromConfig, readComposePreviewMetadata } from "../compose-preview";

type TriggerDeployFn = typeof triggerDeploy;

export interface DevelopmentTaskPreviewResult {
  status: "queued" | "skipped" | "failed";
  previewDeploymentId?: string;
  previewUrl?: string;
  deployments: Array<{
    serviceId: string;
    serviceName: string;
    deploymentId?: string;
    previewUrl?: string;
    status: "queued" | "failed";
    message?: string;
  }>;
  message?: string;
}

function previewUrlFromDeployment(deployment: { configSnapshot: unknown }) {
  const preview = readComposePreviewMetadata(asRecord(deployment.configSnapshot).preview);
  if (!preview?.primaryDomain) {
    return undefined;
  }

  return preview.primaryDomain.startsWith("http")
    ? preview.primaryDomain
    : `https://${preview.primaryDomain}`;
}

export async function queueDevelopmentTaskPreviewDeployments(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  triggerDeployFn?: TriggerDeployFn;
}): Promise<DevelopmentTaskPreviewResult> {
  if (!input.run.branchName || !input.run.pullRequestNumber) {
    return {
      status: "skipped",
      deployments: [],
      message: "Pull request branch and number are required before queuing preview deployments."
    };
  }

  const serviceRows = await db
    .select()
    .from(services)
    .where(eq(services.projectId, input.task.projectId));
  const previewServices = serviceRows.filter((service) => {
    return service.sourceType === "compose" && readComposePreviewConfigFromConfig(service.config);
  });

  if (previewServices.length === 0) {
    return {
      status: "skipped",
      deployments: [],
      message: "No preview-enabled compose services are configured for this project."
    };
  }

  const trigger = input.triggerDeployFn ?? triggerDeploy;
  const deployments: DevelopmentTaskPreviewResult["deployments"] = [];

  for (const service of previewServices) {
    const request: TriggerDeployInput = {
      serviceId: service.id,
      commitSha: input.run.commitSha ?? undefined,
      preview: {
        target: "pull-request",
        branch: input.run.branchName,
        pullRequestNumber: input.run.pullRequestNumber,
        action: "deploy"
      },
      requestedByEmail: input.task.requestedByExternalUser ?? "development-task",
      requestedByRole: null,
      trigger: "agent"
    };
    const result = await trigger(request);

    if (result.status === "ok") {
      const previewUrl = previewUrlFromDeployment(result.deployment);
      deployments.push({
        serviceId: service.id,
        serviceName: service.name,
        deploymentId: result.deployment.id,
        previewUrl,
        status: "queued"
      });
    } else {
      deployments.push({
        serviceId: service.id,
        serviceName: service.name,
        status: "failed",
        message:
          "message" in result && typeof result.message === "string"
            ? result.message
            : `Preview deploy returned ${result.status}.`
      });
    }
  }

  const firstQueued = deployments.find((deployment) => deployment.status === "queued");
  if (!firstQueued) {
    return {
      status: "failed",
      deployments,
      message: "Preview deployment could not be queued for any preview-enabled service."
    };
  }

  return {
    status: "queued",
    previewDeploymentId: firstQueued.deploymentId,
    previewUrl: firstQueued.previewUrl,
    deployments
  };
}
