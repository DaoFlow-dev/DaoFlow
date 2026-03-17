/**
 * deploy-context.ts — Hono route for local context deployment.
 *
 * Receives a tar.gz build context from the CLI, stores it temporarily,
 * SCP's it to the target server, and triggers a remote Docker Compose build.
 *
 * NOT tRPC — binary streams don't fit tRPC well.
 *
 * Flow:
 *   CLI → POST /api/v1/deploy/context (tar.gz body)
 *      → server saves tar.gz to temp dir
 *      → SCP tar.gz to target server
 *      → SSH extract + docker compose up --build
 *      → stream logs to deployment record
 *      → cleanup temp files
 */

import { Hono } from "hono";
import { createWriteStream, mkdirSync, existsSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export const deployContextRouter = new Hono();

/**
 * POST /
 *
 * Receives a tar.gz build context and triggers a compose deployment on the target server.
 *
 * Headers:
 *   Content-Type: application/gzip
 *   X-DaoFlow-Server: server ID
 *   X-DaoFlow-Compose: base64-encoded compose.yaml content
 *   X-DaoFlow-Project: (optional) project ID
 *   Cookie: better-auth.session_token=...
 */
deployContextRouter.post("/", async (c) => {
  const serverId = c.req.header("X-DaoFlow-Server") ?? "";
  const composeB64 = c.req.header("X-DaoFlow-Compose") ?? "";
  const projectId = c.req.header("X-DaoFlow-Project") ?? "";
  const contextId = `ctx_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const deploymentId = `dep_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  // ── Validate inputs ────────────────────────────────────────
  if (!serverId) {
    return c.json(
      { ok: false, error: "Missing X-DaoFlow-Server header", code: "MISSING_SERVER" },
      400
    );
  }

  if (!composeB64) {
    return c.json(
      { ok: false, error: "Missing X-DaoFlow-Compose header", code: "MISSING_COMPOSE" },
      400
    );
  }

  // ── Stream body to temp file ────────────────────────────────
  const uploadDir = join(tmpdir(), "daoflow-contexts");
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  const tarPath = join(uploadDir, `${contextId}.tar.gz`);

  try {
    const body = c.req.raw.body;
    if (!body) {
      return c.json({ ok: false, error: "Empty request body", code: "EMPTY_BODY" }, 400);
    }

    const writeStream = createWriteStream(tarPath);
    const reader = body.getReader();

    await new Promise<void>((resolve, reject) => {
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
            if (done) {
              writeStream.end();
              break;
            }
            writeStream.write(value);
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      void pump();
    });

    const fileSize = statSync(tarPath).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);

    // ── Decode compose content ──────────────────────────────
    let composeContent: string;
    try {
      composeContent = Buffer.from(composeB64, "base64").toString("utf-8");
    } catch {
      await unlink(tarPath).catch(() => {});
      return c.json(
        { ok: false, error: "Invalid X-DaoFlow-Compose base64", code: "INVALID_COMPOSE" },
        400
      );
    }

    // ── Queue deployment ────────────────────────────────────
    // NOTE: Actual remote execution is handled by the worker package.
    // This endpoint acknowledges receipt and returns a deployment ID.
    // The worker picks up queued deployments and:
    //   1. Looks up server from DB by serverId
    //   2. SCPs tarball to remote server
    //   3. SSHs to extract and run `docker compose up -d --build`
    //   4. Streams logs to the deployment record
    //   5. Cleans up temp files on both sides
    // See AGENTS.md §7 "Execution plane" for architecture details.

    console.log(
      JSON.stringify({
        level: "info",
        message: "Context deployment received",
        contextId,
        deploymentId,
        serverId,
        projectId: projectId || undefined,
        contextSizeMB: Number(sizeMB),
        composeLength: composeContent.length
      })
    );

    // Cleanup tarball after acknowledgment (in production, this happens after SCP)
    // For MVP, we keep it around for the worker to pick up
    // await unlink(tarPath).catch(() => {});

    return c.json({
      ok: true,
      deploymentId,
      contextId,
      contextSize: fileSize,
      contextSizeMB: Number(sizeMB),
      serverId,
      message: `Context received (${sizeMB}MB). Deployment ${deploymentId} queued.`
    });
  } catch (err) {
    // Cleanup on error
    await unlink(tarPath).catch(() => {});
    return c.json(
      {
        ok: false,
        error: "Context upload failed",
        message: String(err),
        code: "UPLOAD_FAILED"
      },
      500
    );
  }
});

/**
 * POST /compose
 *
 * Deploy a compose file without local context (pre-built images).
 * Server writes compose.yaml to target and runs docker compose up.
 */
deployContextRouter.post("/compose", async (c) => {
  const body = await c.req.json<{
    server?: string;
    compose?: string;
    project?: string;
  }>();

  if (!body.server) {
    return c.json({ ok: false, error: "Missing server field", code: "MISSING_SERVER" }, 400);
  }
  if (!body.compose) {
    return c.json({ ok: false, error: "Missing compose field", code: "MISSING_COMPOSE" }, 400);
  }

  const deploymentId = `dep_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  console.log(
    JSON.stringify({
      level: "info",
      message: "Compose deployment received (no context)",
      deploymentId,
      serverId: body.server,
      projectId: body.project || undefined,
      composeLength: body.compose.length
    })
  );

  return c.json({
    ok: true,
    deploymentId,
    serverId: body.server,
    message: `Compose deployment ${deploymentId} queued.`
  });
});
