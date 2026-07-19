import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { deployments } from "./db/schema/deployments";
import { claimWebhookDeliveryRecovery } from "./db/services/webhook-delivery-recovery";
import {
  createGitHubComposeWebhookFixture,
  createGitLabComposeWebhookFixture,
  mockGitHubSourceFetch,
  mockGitLabSourceFetch
} from "./testing/webhook-fixtures";
import { resetTestDatabaseWithControlPlane } from "./test-db";

describe("webhook delivery recovery routes", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a reused GitHub delivery id when the signed payload body changes", async () => {
    const fixture = await createGitHubComposeWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/collision-app",
      serviceName: "collision-runtime",
      externalInstallationId: "815",
      webhookSecret: "github-collision-secret"
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitHubSourceFetch({
        repoFullName: "example/collision-app",
        installationId: fixture.externalInstallationId
      })
    );
    const buildPayload = (after: string) =>
      JSON.stringify({
        ref: "refs/heads/main",
        after,
        repository: { full_name: "example/collision-app" },
        installation: { id: Number(fixture.externalInstallationId) },
        sender: { login: "octocat" }
      });
    const sign = (payload: string) =>
      `sha256=${createHmac("sha256", "github-collision-secret").update(payload).digest("hex")}`;
    const firstPayload = buildPayload("1111111111111111111111111111111111111111");
    const changedPayload = buildPayload("2222222222222222222222222222222222222222");
    const app = createApp();

    const first = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-GitHub-Delivery": "gh-delivery-collision",
        "X-Hub-Signature-256": sign(firstPayload)
      },
      body: firstPayload
    });
    const collision = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-GitHub-Delivery": "gh-delivery-collision",
        "X-Hub-Signature-256": sign(changedPayload)
      },
      body: changedPayload
    });

    expect(first.status).toBe(200);
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({
      ok: false,
      error: "Delivery identity does not match payload."
    });
    expect(
      await db.select().from(deployments).where(eq(deployments.serviceName, fixture.serviceName))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.action, "webhook.delivery.collision"))
    ).toHaveLength(1);
  });

  it("returns a retryable response while the same GitHub delivery has a live lease", async () => {
    const fixture = await createGitHubComposeWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/live-lease-app",
      serviceName: "live-lease-runtime",
      externalInstallationId: "816",
      webhookSecret: "github-live-lease-secret"
    });
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "3333333333333333333333333333333333333333",
      repository: { full_name: "example/live-lease-app" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", "github-live-lease-secret").update(payload).digest("hex");
    await claimWebhookDeliveryRecovery({
      providerType: "github",
      eventType: "push",
      deliveryKey: "gh-delivery-live-lease",
      deliveryId: "gh-delivery-live-lease",
      rawBody: payload,
      leaseToken: "existing-live-lease",
      repoFullName: "example/live-lease-app"
    });

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-GitHub-Delivery": "gh-delivery-live-lease",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Delivery is still being processed."
    });
  });

  it("rejects a reused GitLab delivery id when the payload body changes", async () => {
    const fixture = await createGitLabComposeWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/gitlab-collision-app",
      serviceName: "gitlab-collision-runtime",
      webhookSecret: "gitlab-collision-secret",
      projectApiId: 817
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabSourceFetch({
        repoFullName: "example/gitlab-collision-app",
        projectId: 817
      })
    );
    const buildPayload = (after: string) =>
      JSON.stringify({
        ref: "refs/heads/main",
        after,
        checkout_sha: after,
        project: { id: 817, path_with_namespace: "example/gitlab-collision-app" },
        user_name: "gitlab-bot"
      });
    const app = createApp();
    const first = await app.request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Token": "gitlab-collision-secret",
        "X-GitLab-Event-UUID": "gitlab-delivery-collision"
      },
      body: buildPayload("4444444444444444444444444444444444444444")
    });
    const collision = await app.request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Token": "gitlab-collision-secret",
        "X-GitLab-Event-UUID": "gitlab-delivery-collision"
      },
      body: buildPayload("5555555555555555555555555555555555555555")
    });

    expect(first.status).toBe(200);
    expect(collision.status).toBe(409);
    expect(
      await db.select().from(deployments).where(eq(deployments.serviceName, fixture.serviceName))
    ).toHaveLength(1);
  });
});
