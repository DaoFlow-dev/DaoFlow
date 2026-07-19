import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import { environments, projects } from "../db/schema/projects";
import { claimWebhookDeliveryRecovery } from "../db/services/webhook-delivery-recovery";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import {
  claimRecoverableWebhookDelivery,
  createWebhookPushRecoveryContext
} from "./webhook-push-recovery";

describe("webhook push recovery route integration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("retries only failed targets after preserving an earlier queued target", async () => {
    const rawBody = JSON.stringify({ ref: "refs/heads/main", after: "abc123" });
    const firstClaim = await claimRecoverableWebhookDelivery({
      providerType: "github",
      eventType: "push",
      deliveryKey: "delivery-partial-retry",
      providerDeliveryId: "delivery-partial-retry",
      rawBody,
      repoFullName: "example/recovery",
      commitSha: "abc123",
      metadata: { branch: "main", commitSha: "abc123" }
    });
    expect(firstClaim.kind).toBe("new");
    if (firstClaim.kind !== "new") {
      throw new Error("Expected a new webhook delivery claim.");
    }

    const first = await createWebhookPushRecoveryContext(firstClaim);
    await first.registerDiscoveredTargets(["service:svc_recovery_a", "service:svc_recovery_b"]);
    await first.onTargetStarted({ targetKey: "service:svc_recovery_a" });
    await first.onTargetOutcome({
      targetKey: "service:svc_recovery_a",
      status: "queued",
      projectId: "project_recovery",
      projectName: "Recovery",
      serviceId: "svc_recovery_a",
      deploymentId: "deployment_recovery_a"
    });
    await first.onTargetStarted({ targetKey: "service:svc_recovery_b" });
    await first.onTargetOutcome({
      targetKey: "service:svc_recovery_b",
      status: "failed",
      projectId: "project_recovery",
      projectName: "Recovery",
      serviceId: "svc_recovery_b",
      failureStatus: "provider_unavailable",
      message: "Provider validation is temporarily unavailable."
    });
    await first.complete({
      deploymentCount: 1,
      failedTargetCount: 1,
      ignoredTargetCount: 0,
      detail: "One target queued and one target failed."
    });

    const retryClaim = await claimRecoverableWebhookDelivery({
      providerType: "github",
      eventType: "push",
      deliveryKey: "delivery-partial-retry",
      providerDeliveryId: "delivery-partial-retry",
      rawBody,
      repoFullName: "example/recovery",
      commitSha: "abc123",
      metadata: { branch: "main", commitSha: "abc123" }
    });
    expect(retryClaim.kind).toBe("reclaimed");
    if (retryClaim.kind !== "reclaimed") {
      throw new Error("Expected a reclaimed webhook delivery claim.");
    }

    const retry = await createWebhookPushRecoveryContext(retryClaim);
    expect(retry.shouldProcessTarget("service:svc_recovery_a")).toBe(false);
    expect(retry.shouldProcessTarget("service:svc_recovery_b")).toBe(true);
  });

  it("persists all discovered targets before side effects so a later target survives a crash", async () => {
    const startedAt = new Date();
    const rawBody = '{"ref":"refs/heads/main","after":"crash-window"}';
    const firstClaim = await claimWebhookDeliveryRecovery({
      providerType: "github",
      eventType: "push",
      deliveryKey: "delivery-crash-before-next-target",
      rawBody,
      leaseToken: "lease-crash-first",
      leaseDurationMs: 1_000,
      now: startedAt
    });
    if (firstClaim.kind !== "new") throw new Error("Expected a new delivery claim.");

    const first = await createWebhookPushRecoveryContext(firstClaim);
    await first.registerDiscoveredTargets(["service:svc_crash_a", "service:svc_crash_b"]);
    await first.onTargetOutcome({
      targetKey: "service:svc_crash_a",
      status: "queued",
      projectId: "project_crash",
      projectName: "Crash",
      serviceId: "svc_crash_a",
      deploymentId: "deployment_crash_a"
    });

    const retryClaim = await claimWebhookDeliveryRecovery({
      providerType: "github",
      eventType: "push",
      deliveryKey: "delivery-crash-before-next-target",
      rawBody,
      leaseToken: "lease-crash-second",
      now: new Date(startedAt.getTime() + 1_001)
    });
    if (retryClaim.kind !== "reclaimed") throw new Error("Expected a reclaimed delivery claim.");

    const retry = await createWebhookPushRecoveryContext(retryClaim);
    await retry.registerDiscoveredTargets(["service:svc_crash_a", "service:svc_crash_b"]);
    expect(retry.shouldProcessTarget("service:svc_crash_a")).toBe(false);
    expect(retry.shouldProcessTarget("service:svc_crash_b")).toBe(true);
  });

  it("recovers the uniquely stamped deployment after a crash before target completion", async () => {
    await db.insert(projects).values({
      id: "proj_webhook_crash_queue",
      name: "Webhook Crash Queue",
      teamId: "team_foundation"
    });
    await db.insert(environments).values({
      id: "env_webhook_crash_queue",
      name: "Production",
      slug: "production",
      projectId: "proj_webhook_crash_queue"
    });
    const claim = await claimRecoverableWebhookDelivery({
      providerType: "github",
      eventType: "push",
      deliveryKey: "delivery-crash-after-queue",
      rawBody: '{"ref":"refs/heads/main","after":"queued"}',
      repoFullName: "example/crash-after-queue",
      commitSha: "queued",
      metadata: { branch: "main" }
    });
    if (claim.kind !== "new") throw new Error("Expected a new delivery claim.");
    const context = await createWebhookPushRecoveryContext(claim);
    const targetKey = "service:svc_crash_queue";
    await context.registerDiscoveredTargets([targetKey]);
    await context.onTargetStarted({ targetKey });

    await db.insert(deployments).values({
      id: "dep_webhook_crash_queue",
      projectId: "proj_webhook_crash_queue",
      environmentId: "env_webhook_crash_queue",
      targetServerId: "srv_foundation_1",
      serviceName: "api",
      sourceType: "compose",
      configSnapshot: {},
      trigger: "webhook",
      webhookDeliveryId: claim.deliveryId,
      webhookTargetKey: targetKey
    });

    await expect(context.findRecoveredDeployment(targetKey)).resolves.toMatchObject({
      id: "dep_webhook_crash_queue"
    });
    await expect(
      db.insert(deployments).values({
        id: "dep_webhook_crash_duplicate",
        projectId: "proj_webhook_crash_queue",
        environmentId: "env_webhook_crash_queue",
        targetServerId: "srv_foundation_1",
        serviceName: "api",
        sourceType: "compose",
        configSnapshot: {},
        trigger: "webhook",
        webhookDeliveryId: claim.deliveryId,
        webhookTargetKey: targetKey
      })
    ).rejects.toThrow();
  });
});
