import { Hono } from "hono";
import { statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { auth } from "../auth";
import { streamBodyToFile } from "./stream-to-file";
import { dockerLoad, dockerListImages, type DockerImageListEntry } from "../worker/docker-executor";

const imagesRouter = new Hono();

/**
 * Collect logs from worker-layer Docker functions into a string buffer.
 * In future this can be connected to the structured event system.
 */
function collectLogs(): { logs: string[]; onLog: import("../worker/docker-executor").OnLog } {
  const logs: string[] = [];
  return {
    logs,
    onLog: (line) => {
      logs.push(line.message);
    }
  };
}

/**
 * POST /push
 *
 * Receives a Docker image tarball (gzipped) and loads it on the target server.
 * Query params: tag, server, service
 */
imagesRouter.post("/push", async (c) => {
  // Auth gate: validate session via Better Auth (same as tRPC context)
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json(
      {
        status: "error",
        error: "unauthorized",
        message: "Valid authentication required. Provide a session cookie or Bearer token.",
        code: "AUTH_REQUIRED"
      },
      401
    );
  }

  const tag = c.req.query("tag") ?? "daoflow-app:latest";
  const serverId = c.req.query("server") ?? "";
  const serviceName = c.req.query("service") ?? "";
  const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);

  const tarPath = join(tmpdir(), "daoflow-uploads", `${uploadId}.tar.gz`);

  try {
    // Stream request body to disk
    const body = c.req.raw.body;
    if (!body) {
      return c.json({ status: "error", error: "empty_body", message: "No body" }, 400);
    }

    await streamBodyToFile(body, tarPath);

    const fileSize = statSync(tarPath).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);

    // Load image via worker-layer Docker executor (AGENTS.md §7)
    const { onLog } = collectLogs();
    const result = await dockerLoad(tarPath, onLog);

    if (result.exitCode !== 0) {
      return c.json(
        {
          status: "error",
          error: "docker_load_failed",
          message: "Failed to load Docker image",
          uploadId
        },
        500
      );
    }

    // Cleanup tarball (async, best-effort)
    await unlink(tarPath).catch(() => {});

    return c.json({
      status: "ok",
      uploadId,
      tag,
      sizeMB: Number(sizeMB),
      serverId: serverId || null,
      serviceName: serviceName || null,
      message: `Image ${tag} loaded successfully (${sizeMB} MB)`
    });
  } catch (err) {
    return c.json(
      {
        status: "error",
        error: "upload_failed",
        message: String(err)
      },
      500
    );
  }
});

/**
 * GET /
 *
 * List Docker images on the server.
 */
imagesRouter.get("/", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json(
      {
        status: "error",
        error: "unauthorized",
        message: "Valid authentication required. Provide a session cookie or Bearer token.",
        code: "AUTH_REQUIRED"
      },
      401
    );
  }

  try {
    const { onLog } = collectLogs();
    const result = await dockerListImages(onLog);
    const images: DockerImageListEntry[] = result.images;
    return c.json({ images });
  } catch {
    return c.json({ images: [] });
  }
});

export { imagesRouter };
