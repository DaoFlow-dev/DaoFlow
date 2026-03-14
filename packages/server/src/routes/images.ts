import { Hono } from "hono";
import { createWriteStream, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

const imagesRouter = new Hono();

/**
 * POST /push
 *
 * Receives a Docker image tarball (gzipped) and loads it on the target server.
 * Query params: tag, server, service
 *
 * This is the server-side of `daoflow push` — streams a Docker save tarball
 * directly to the server and loads it via `docker load`.
 */
imagesRouter.post("/push", async (c) => {
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

    // Load image into Docker
    try {
      execSync(`docker load < ${tarPath}`, {
        timeout: 300_000,
        stdio: "pipe"
      });
    } catch (err: unknown) {
      const stderr =
        err instanceof Error
          ? err.message
          : typeof err === "object" &&
              err !== null &&
              "stderr" in err &&
              typeof (err as { stderr: unknown }).stderr === "object"
            ? String((err as { stderr: { toString(): string } }).stderr)
            : "Failed to load Docker image";
      return c.json(
        {
          status: "error",
          error: "docker_load_failed",
          message: stderr,
          uploadId
        },
        500
      );
    }

    // Cleanup tarball
    try {
      execSync(`rm -f ${tarPath}`);
    } catch {
      /* ignore */
    }

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

imagesRouter.get("/", (c) => {
  try {
    const output = execSync("docker images --format json", {
      timeout: 10_000,
      encoding: "utf-8"
    });

    const images: DockerImageInfo[] = output
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
