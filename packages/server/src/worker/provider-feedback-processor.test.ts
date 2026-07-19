import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import { providerFeedback, providerFeedbackTargets } from "../db/schema/provider-feedback";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { transitionDeploymentWithFeedback } from "../db/services/deployment-transition-feedback";
import {
  claimNextProviderFeedback,
  markProviderFeedbackDelivered
} from "../db/services/provider-feedback-claims";
import { queueProviderFeedbackIntent } from "../db/services/provider-feedback-intents";
import { createProviderFeedbackFixture } from "../db/services/provider-feedback-fixtures";
import {
  registerProviderFeedbackAdapter,
  resetProviderFeedbackAdaptersForTests
} from "./provider-feedback-adapter-registry";
import { runProviderFeedbackMonitorCycle } from "./provider-feedback-monitor";
import {
  processNextProviderFeedback,
  ProviderFeedbackDeliveryError,
  ProviderFeedbackSkippedError
} from "./provider-feedback-processor";

async function queueFixtureFeedback() {
  const fixture = await createProviderFeedbackFixture();
  await db.transaction((tx) =>
    queueProviderFeedbackIntent(tx, {
      deploymentId: fixture.deploymentId,
      transition: "queued"
    })
  );
  return fixture;
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("provider feedback processor", () => {
  beforeEach(async () => {
    resetProviderFeedbackAdaptersForTests();
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(() => {
    resetProviderFeedbackAdaptersForTests();
  });

  it("stays idle and leaves feedback pending until an adapter is registered", async () => {
    const fixture = await queueFixtureFeedback();

    await expect(runProviderFeedbackMonitorCycle()).resolves.toEqual({
      status: "idle",
      processedCount: 0
    });

    const [feedback] = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    expect(feedback).toMatchObject({ state: "pending", attemptCount: 0 });
  });

  it("retries a provider outage without changing the deployment result", async () => {
    const fixture = await queueFixtureFeedback();
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "completed",
      conclusion: "succeeded"
    });
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.reject(
          new ProviderFeedbackDeliveryError({
            safeMessage: "Provider is temporarily unavailable.",
            statusCode: 503
          })
        );
      }
    });

    const now = new Date("2026-07-19T12:00:00.000Z");
    await expect(processNextProviderFeedback({ now })).resolves.toMatchObject({
      status: "retrying"
    });

    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, fixture.deploymentId));
    const feedbackRows = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    const feedback = feedbackRows.find((row) => row.state === "retrying");
    expect(deployment).toMatchObject({ status: "completed", conclusion: "succeeded" });
    expect(feedback).toMatchObject({ state: "retrying", attemptCount: 1 });
    expect(feedback?.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("honors Retry-After for provider rate limits", async () => {
    const fixture = await queueFixtureFeedback();
    const now = new Date();
    await db
      .update(providerFeedback)
      .set({ nextAttemptAt: now })
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.reject(
          new ProviderFeedbackDeliveryError({
            safeMessage: "Provider rate limit reached.",
            statusCode: 429,
            retryAfterMs: 30_000
          })
        );
      }
    });

    await expect(processNextProviderFeedback({ now })).resolves.toMatchObject({
      status: "retrying"
    });

    const [feedback] = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    expect(feedback).toMatchObject({ state: "retrying", attemptCount: 1 });
    expect(feedback?.nextAttemptAt.getTime()).toBe(now.getTime() + 30_000);
  });

  it("dead-letters permanent provider rejections", async () => {
    const fixture = await queueFixtureFeedback();
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.reject(
          new ProviderFeedbackDeliveryError({
            safeMessage: "Repository access was denied.",
            statusCode: 403
          })
        );
      }
    });

    await expect(processNextProviderFeedback()).resolves.toMatchObject({
      status: "dead-letter"
    });

    const [feedback] = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    expect(feedback).toMatchObject({
      state: "dead-letter",
      attemptCount: 1,
      safeError: "Repository access was denied."
    });
  });

  it("keeps later transitions blocked behind a dead-letter row", async () => {
    const fixture = await queueFixtureFeedback();
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "completed",
      conclusion: "succeeded"
    });
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.reject(
          new ProviderFeedbackDeliveryError({
            safeMessage: "Repository access was denied.",
            statusCode: 403
          })
        );
      }
    });
    await processNextProviderFeedback();

    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.resolve({ externalDeploymentId: "must-not-be-created" });
      }
    });
    await expect(processNextProviderFeedback()).resolves.toBeNull();

    const rows = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    expect(rows.find((row) => row.transition === "queued")?.state).toBe("dead-letter");
    expect(rows.find((row) => row.transition === "completed")?.state).toBe("pending");
  });

  it("records capability skips without blocking later transitions", async () => {
    const fixture = await queueFixtureFeedback();
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "completed",
      conclusion: "succeeded"
    });
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.reject(
          new ProviderFeedbackSkippedError(
            "Provider credentials are clone-only; deployment feedback was skipped."
          )
        );
      }
    });

    await expect(processNextProviderFeedback()).resolves.toMatchObject({ status: "skipped" });
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.resolve();
      }
    });
    await expect(processNextProviderFeedback()).resolves.toMatchObject({ status: "delivered" });

    const rows = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    expect(rows.find((row) => row.transition === "queued")).toMatchObject({
      state: "skipped",
      safeError: "Provider credentials are clone-only; deployment feedback was skipped."
    });
    expect(rows.find((row) => row.transition === "completed")?.state).toBe("delivered");
  });

  it("passes stored external IDs to later transitions and preserves them", async () => {
    const fixture = await queueFixtureFeedback();
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.resolve({
          externalDeploymentId: "github-deployment-1",
          externalStatusId: "github-status-1",
          externalCommentId: "github-comment-1"
        });
      }
    });
    await processNextProviderFeedback();

    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "completed",
      conclusion: "succeeded"
    });
    const secondAdapter = vi.fn().mockResolvedValue({ externalStatusId: "github-status-2" });
    registerProviderFeedbackAdapter({ providerKind: "github", upsertFeedback: secondAdapter });
    await processNextProviderFeedback();

    expect(secondAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        transition: "completed",
        externalIds: {
          externalDeploymentId: "github-deployment-1",
          externalStatusId: "github-status-1",
          externalCommentId: "github-comment-1"
        }
      })
    );
    const rows = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    const completed = rows.find((row) => row.transition === "completed");
    expect(completed).toMatchObject({
      state: "delivered",
      externalDeploymentId: "github-deployment-1",
      externalStatusId: "github-status-2",
      externalCommentId: "github-comment-1"
    });
  });

  it("dead-letters attempts to replace a stable external target identity", async () => {
    const fixture = await queueFixtureFeedback();
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.resolve({
          externalDeploymentId: "github-deployment-1",
          externalCommentId: "github-comment-1"
        });
      }
    });
    await processNextProviderFeedback();
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "completed",
      conclusion: "succeeded"
    });
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback() {
        return Promise.resolve({
          externalDeploymentId: "github-deployment-2",
          externalCommentId: "github-comment-2"
        });
      }
    });

    await expect(processNextProviderFeedback()).resolves.toMatchObject({
      status: "dead-letter"
    });
    const [target] = await db
      .select()
      .from(providerFeedbackTargets)
      .where(eq(providerFeedbackTargets.deploymentId, fixture.deploymentId));
    expect(target).toMatchObject({
      externalDeploymentId: "github-deployment-1",
      externalCommentId: "github-comment-1"
    });
  });

  it("rejects finalization after lease expiry and allows a fenced reclaim", async () => {
    await queueFixtureFeedback();
    const claimedAt = new Date("2026-07-19T12:00:00.000Z");
    const first = await claimNextProviderFeedback({
      providerKinds: ["github"],
      now: claimedAt,
      leaseDurationMs: 1_000
    });
    expect(first).not.toBeNull();

    const reclaimedAt = new Date(claimedAt.getTime() + 1_001);
    await expect(
      markProviderFeedbackDelivered({
        feedbackId: first?.id ?? "",
        leaseToken: first?.leaseToken ?? "",
        now: reclaimedAt
      })
    ).resolves.toBeNull();
    const second = await claimNextProviderFeedback({
      providerKinds: ["github"],
      now: reclaimedAt,
      leaseDurationMs: 1_000
    });
    expect(second?.id).toBe(first?.id);
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
  });

  it("rejects finalization when a database lock wait crosses lease expiry", async () => {
    await queueFixtureFeedback();
    const first = await claimNextProviderFeedback({
      providerKinds: ["github"],
      leaseDurationMs: 200
    });
    expect(first).not.toBeNull();

    const lockAcquired = createDeferred();
    const releaseLock = createDeferred();
    const blocker = db.transaction(async (tx) => {
      await tx
        .select({ id: providerFeedback.id })
        .from(providerFeedback)
        .where(eq(providerFeedback.id, first?.id ?? ""))
        .for("update");
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    await lockAcquired.promise;

    const finalization = expect(
      markProviderFeedbackDelivered({
        feedbackId: first?.id ?? "",
        leaseToken: first?.leaseToken ?? ""
      })
    ).resolves.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseLock.resolve();
    await blocker;
    await finalization;
  });

  it("delivers same-millisecond transitions in insertion order", async () => {
    const fixture = await createProviderFeedbackFixture();
    const now = new Date("2026-07-19T12:00:00.000Z");
    await db.transaction((tx) =>
      queueProviderFeedbackIntent(tx, {
        deploymentId: fixture.deploymentId,
        transition: "queued",
        now
      })
    );
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "completed",
      conclusion: "succeeded",
      now
    });

    const deliveredTransitions: string[] = [];
    registerProviderFeedbackAdapter({
      providerKind: "github",
      upsertFeedback(input) {
        deliveredTransitions.push(input.transition);
        return Promise.resolve();
      }
    });

    await processNextProviderFeedback({ now });
    await processNextProviderFeedback({ now });

    expect(deliveredTransitions).toEqual(["queued", "completed"]);
    const rows = await db
      .select({
        sequence: providerFeedback.deliverySequence,
        transition: providerFeedback.transition
      })
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    expect(
      rows.sort((left, right) => left.sequence - right.sequence).map((row) => row.transition)
    ).toEqual(["queued", "completed"]);
  });
});
