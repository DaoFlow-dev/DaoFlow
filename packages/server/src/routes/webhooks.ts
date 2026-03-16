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
import { createDeploymentRecord } from "../db/services/deployments";
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
    for (const project of matchingProjects) {
      const targetBranch = project.autoDeployBranch || project.defaultBranch || "main";
      if (branch !== targetBranch) continue;

      const deployment = await createDeploymentRecord({
        projectName: project.name,
        environmentName: "production",
        serviceName: project.name,
        sourceType: project.sourceType as "compose" | "dockerfile" | "image",
        targetServerId: "",
        commitSha,
        imageTag: "",
        requestedByUserId: "",
        requestedByEmail: payload.sender?.login ?? "github-webhook",
        requestedByRole: "agent",
        steps: [
          { label: "Webhook received", detail: `Push to ${branch} by ${payload.sender?.login}` },
          { label: "Clone repository", detail: `${repoFullName}@${commitSha.slice(0, 7)}` },
          { label: "Build", detail: `Source: ${project.sourceType}` },
          { label: "Deploy", detail: "Starting containers" },
          { label: "Health check", detail: "Verifying deployment" }
        ]
      });
      if (deployment) deployments.push(deployment);
    }

    await db.insert(auditEntries).values({
      actorType: "system",
      actorId: "github-webhook",
      actorEmail: payload.sender?.login ?? "webhook",
      actorRole: "agent",
      targetResource: `webhook/github/${repoFullName}`,
      action: "webhook.push",
      inputSummary: `Push to ${branch} (${commitSha.slice(0, 7)}) → ${deployments.length} deployments`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: { repoFullName, branch, commitSha, deploymentCount: deployments.length }
    });

    return c.json({
      ok: true,
      deployments: deployments.length,
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
    for (const project of matchingProjects) {
      const targetBranch = project.autoDeployBranch || project.defaultBranch || "main";
      if (branch !== targetBranch) continue;

      const deployment = await createDeploymentRecord({
        projectName: project.name,
        environmentName: "production",
        serviceName: project.name,
        sourceType: project.sourceType as "compose" | "dockerfile" | "image",
        targetServerId: "",
        commitSha,
        imageTag: "",
        requestedByUserId: "",
        requestedByEmail: payload.user_name ?? "gitlab-webhook",
        requestedByRole: "agent",
        steps: [
          { label: "Webhook received", detail: `Push to ${branch} by ${payload.user_name}` },
          { label: "Clone repository", detail: `${repoFullName}@${commitSha.slice(0, 7)}` },
          { label: "Build", detail: `Source: ${project.sourceType}` },
          { label: "Deploy", detail: "Starting containers" },
          { label: "Health check", detail: "Verifying deployment" }
        ]
      });
      if (deployment) deployments.push(deployment);
    }

    await db.insert(auditEntries).values({
      actorType: "system",
      actorId: "gitlab-webhook",
      actorEmail: payload.user_name ?? "webhook",
      actorRole: "agent",
      targetResource: `webhook/gitlab/${repoFullName}`,
      action: "webhook.push",
      inputSummary: `Push to ${branch} (${commitSha.slice(0, 7)}) → ${deployments.length} deployments`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: { repoFullName, branch, commitSha, deploymentCount: deployments.length }
    });

    return c.json({
      ok: true,
      deployments: deployments.length,
      branch,
      commit: commitSha.slice(0, 7)
    });
  } catch (err) {
    console.error("[webhook/gitlab] Error:", err);
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
});
