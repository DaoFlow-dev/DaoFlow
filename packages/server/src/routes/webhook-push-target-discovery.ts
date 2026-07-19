import { and, eq } from "drizzle-orm";
import { normalizeComposePreviewRequest } from "../compose-preview";
import { db } from "../db/connection";
import { services } from "../db/schema/services";
import { listEligiblePreviewWebhookServices } from "../db/services/webhook-deliveries";
import { matchWebhookWatchedPaths, readWebhookAutoDeployConfig } from "../webhook-auto-deploy";
import { webhookProjectTargetKey, webhookServiceTargetKey } from "./webhook-target-keys";
import type { WebhookTarget } from "./webhooks-types";

export async function listComposeWebhookServiceIds(projectId: string) {
  return db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.projectId, projectId), eq(services.sourceType, "compose")));
}

export async function discoverWebhookPushTargetKeys(input: {
  branch: string;
  changedPaths: string[];
  deleted?: boolean;
  matchingTargets: WebhookTarget[];
}) {
  const targetKeys = new Set<string>();

  for (const { project } of input.matchingTargets) {
    const targetBranch = project.autoDeployBranch || project.defaultBranch || "main";
    if (input.branch !== targetBranch) {
      const previewRequest = normalizeComposePreviewRequest({
        target: "branch",
        branch: input.branch,
        action: input.deleted === true ? "destroy" : "deploy"
      });
      const previewServices = await listEligiblePreviewWebhookServices({
        projectId: project.id,
        previewRequest
      });
      if (previewServices.length > 0) {
        previewServices.forEach((service) => targetKeys.add(webhookServiceTargetKey(service.id)));
      } else {
        targetKeys.add(webhookProjectTargetKey(project.id));
      }
      continue;
    }

    const pathMatch = matchWebhookWatchedPaths({
      watchedPaths: readWebhookAutoDeployConfig(project.config).watchedPaths,
      changedPaths: input.changedPaths
    });
    if (!pathMatch.matched) {
      targetKeys.add(webhookProjectTargetKey(project.id));
      continue;
    }

    const composeServices = await listComposeWebhookServiceIds(project.id);
    if (composeServices.length === 0) {
      targetKeys.add(webhookProjectTargetKey(project.id));
    } else {
      composeServices.forEach((service) => targetKeys.add(webhookServiceTargetKey(service.id)));
    }
  }

  return [...targetKeys];
}
