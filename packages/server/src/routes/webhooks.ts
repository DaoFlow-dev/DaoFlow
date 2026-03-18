/**
 * webhooks.ts — Hono webhook receiver routes.
 *
 * NOT tRPC — these are standard Hono routes because:
 * 1. Webhook payloads require raw body for HMAC validation
 * 2. GitHub/GitLab send POST with specific content types
 * 3. No auth token — authenticated via HMAC signature
 */

import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/connection";
import { gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { services } from "../db/schema/services";
import { triggerDeploy } from "../db/services/trigger-deploy";
import { auditEntries } from "../db/schema/audit";

/* ──────────────────────── HMAC Validation ──────────────────────── */

function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyGitLabToken(token: string, expected: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

/* ──────────────────────── Types ──────────────────────── */

interface GitHubPushEvent {
  ref?: string;
  after?: string;
  repository?: { full_name?: string };
  sender?: { login?: string };
}

interface GitLabPushEvent {
  ref?: string;
  after?: string;
  project?: { path_with_namespace?: string };
  user_name?: string;
}

interface WebhookDeployFailure {
  serviceId: string;
  status: string;
  entity?: string;
}

async function triggerWebhookDeploys(input: {
  projectId: string;
  commitSha: string;
  requestedByEmail: string;
}) {
  const matchingServices = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.projectId, input.projectId));

  const queuedDeployments = [];
  const failures: WebhookDeployFailure[] = [];
  for (const service of matchingServices) {
    const result = await triggerDeploy({
      serviceId: service.id,
      commitSha: input.commitSha,
      requestedByUserId: null,
      requestedByEmail: input.requestedByEmail,
      requestedByRole: "agent",
      trigger: "webhook"
    });

    if (result.status === "ok" && result.deployment) {
      queuedDeployments.push(result.deployment);
      continue;
    }

    failures.push({
      serviceId: service.id,
      status: result.status,
      entity: result.status === "not_found" ? result.entity : undefined
    });
  }

  return {
    deployments: queuedDeployments,
    failures
  };
}

/* ──────────────────────── Routes ──────────────────────── */

export const webhooksRouter = new Hono();

/**
 * POST /github — receives push events from GitHub Apps.
 */
webhooksRouter.post("/github", async (c) => {
  try {
    const event = c.req.header("x-github-event");
    if (event !== "push") {
      return c.json({ ok: true, skipped: true, reason: "not a push event" });
    }

    const signature = c.req.header("x-hub-signature-256");
    if (!signature) {
      return c.json({ ok: false, error: "Missing signature" }, 401);
    }

    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as GitHubPushEvent;

    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      return c.json({ ok: false, error: "Missing repository" }, 400);
    }

    // Find matching auto-deploy projects
    const matchingProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.repoFullName, repoFullName), eq(projects.autoDeploy, true)));

    if (matchingProjects.length === 0) {
      return c.json({ ok: true, skipped: true, reason: "no matching projects" });
    }

    // Validate signature against git provider webhook secret
    let signatureValid = false;
    for (const project of matchingProjects) {
      if (!project.gitProviderId) continue;
      const [provider] = await db
        .select()
        .from(gitProviders)
        .where(eq(gitProviders.id, project.gitProviderId))
        .limit(1);
      if (
        provider?.webhookSecret &&
        verifyGitHubSignature(rawBody, signature, provider.webhookSecret)
      ) {
        signatureValid = true;
        break;
      }
    }

    if (!signatureValid) {
      return c.json({ ok: false, error: "Invalid signature" }, 401);
    }

    const branch = (payload.ref ?? "").replace("refs/heads/", "");
    const commitSha = payload.after ?? "";

    const deployments = [];
    const failedTargets: WebhookDeployFailure[] = [];
    for (const project of matchingProjects) {
      const targetBranch = project.autoDeployBranch || project.defaultBranch || "main";
      if (branch !== targetBranch) continue;

      const projectResult = await triggerWebhookDeploys({
        projectId: project.id,
        commitSha,
        requestedByEmail: payload.sender?.login ?? "github-webhook"
      });
      deployments.push(...projectResult.deployments);
      failedTargets.push(...projectResult.failures);
    }

    if (failedTargets.length > 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "GitHub webhook auto-deploy skipped one or more targets",
          repoFullName,
          branch,
          commitSha,
          failedTargets
        })
      );
    }

    await db.insert(auditEntries).values({
      actorType: "system",
      actorId: "github-webhook",
      actorEmail: payload.sender?.login ?? "webhook",
      actorRole: "agent",
      targetResource: `webhook/github/${repoFullName}`,
      action: "webhook.push",
      inputSummary: `Push to ${branch} (${commitSha.slice(0, 7)}) → ${deployments.length} deployments, ${failedTargets.length} failures`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: {
        repoFullName,
        branch,
        commitSha,
        deploymentCount: deployments.length,
        failedTargetCount: failedTargets.length,
        failedTargets
      }
    });

    return c.json({
      ok: true,
      deployments: deployments.length,
      failedTargets: failedTargets.length,
      branch,
      commit: commitSha.slice(0, 7)
    });
  } catch (err) {
    console.error("[webhook/github] Error:", err);
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
});

/**
 * POST /gitlab — receives push events from GitLab webhooks.
 */
webhooksRouter.post("/gitlab", async (c) => {
  try {
    const token = c.req.header("x-gitlab-token");
    if (!token) {
      return c.json({ ok: false, error: "Missing token" }, 401);
    }

    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as GitLabPushEvent;

    const repoFullName = payload.project?.path_with_namespace;
    if (!repoFullName) {
      return c.json({ ok: false, error: "Missing project" }, 400);
    }

    const matchingProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.repoFullName, repoFullName), eq(projects.autoDeploy, true)));

    if (matchingProjects.length === 0) {
      return c.json({ ok: true, skipped: true, reason: "no matching projects" });
    }

    // Validate token
    let tokenValid = false;
    for (const project of matchingProjects) {
      if (!project.gitProviderId) continue;
      const [provider] = await db
        .select()
        .from(gitProviders)
        .where(eq(gitProviders.id, project.gitProviderId))
        .limit(1);
      if (provider?.webhookSecret && verifyGitLabToken(token, provider.webhookSecret)) {
        tokenValid = true;
        break;
      }
    }

    if (!tokenValid) {
      return c.json({ ok: false, error: "Invalid token" }, 401);
    }

    const branch = (payload.ref ?? "").replace("refs/heads/", "");
    const commitSha = payload.after ?? "";

    const deployments = [];
    const failedTargets: WebhookDeployFailure[] = [];
    for (const project of matchingProjects) {
      const targetBranch = project.autoDeployBranch || project.defaultBranch || "main";
      if (branch !== targetBranch) continue;

      const projectResult = await triggerWebhookDeploys({
        projectId: project.id,
        commitSha,
        requestedByEmail: payload.user_name ?? "gitlab-webhook"
      });
      deployments.push(...projectResult.deployments);
      failedTargets.push(...projectResult.failures);
    }

    if (failedTargets.length > 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "GitLab webhook auto-deploy skipped one or more targets",
          repoFullName,
          branch,
          commitSha,
          failedTargets
        })
      );
    }

    await db.insert(auditEntries).values({
      actorType: "system",
      actorId: "gitlab-webhook",
      actorEmail: payload.user_name ?? "webhook",
      actorRole: "agent",
      targetResource: `webhook/gitlab/${repoFullName}`,
      action: "webhook.push",
      inputSummary: `Push to ${branch} (${commitSha.slice(0, 7)}) → ${deployments.length} deployments, ${failedTargets.length} failures`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: {
        repoFullName,
        branch,
        commitSha,
        deploymentCount: deployments.length,
        failedTargetCount: failedTargets.length,
        failedTargets
      }
    });

    return c.json({
      ok: true,
      deployments: deployments.length,
      failedTargets: failedTargets.length,
      branch,
      commit: commitSha.slice(0, 7)
    });
  } catch (err) {
    console.error("[webhook/gitlab] Error:", err);
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
});
