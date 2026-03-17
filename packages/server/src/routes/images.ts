import { Hono } from "hono";
import { createWriteStream, mkdirSync, existsSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { auth } from "../auth";

const imagesRouter = new Hono();

/**
 * Run a shell command asynchronously using Bun.spawn so the server
 * stays responsive while Docker operations complete.
 */
async function exec(
  cmd: string[],
  opts?: { timeout?: number; stdin?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    stdin: opts?.stdin ? new Response(opts.stdin).body! : "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });

  const timeout = opts?.timeout ?? 30_000;
  const timer = setTimeout(() => proc.kill(), timeout);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  return { stdout, stderr, exitCode };
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

  const uploadDir = join(tmpdir(), "daoflow-uploads");
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  const tarPath = join(uploadDir, `${uploadId}.tar.gz`);

  try {
    // Stream request body to disk
    const body = c.req.raw.body;
    if (!body) {
      return c.json({ status: "error", error: "empty_body", message: "No body" }, 400);
    }

    const writeStream = createWriteStream(tarPath);
    const reader = body.getReader();

    await new Promise<void>((resolve, reject) => {
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
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

    // Load image into Docker (async — does NOT block the server)
    const result = await exec(["docker", "load", "-i", tarPath], {
      timeout: 300_000
    });

    if (result.exitCode !== 0) {
      return c.json(
        {
          status: "error",
          error: "docker_load_failed",
          message: result.stderr || "Failed to load Docker image",
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
interface DockerImageInfo {
  Repository: string;
  Tag: string;
  ID: string;
  CreatedAt: string;
  Size: string;
}

imagesRouter.get("/", async (c) => {
  try {
    const result = await exec(["docker", "images", "--format", "json"], {
      timeout: 10_000
    });

    const images: DockerImageInfo[] = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string): DockerImageInfo | null => {
        try {
          return JSON.parse(line) as DockerImageInfo;
        } catch {
          return null;
        }
      })
      .filter((item): item is DockerImageInfo => item !== null);

    return c.json({ images });
  } catch {
    return c.json({ images: [] });
  }
});

export { imagesRouter };
