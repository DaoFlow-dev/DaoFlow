import { Router } from "express";
import { createWriteStream, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

const router: ReturnType<typeof Router> = Router();

/**
 * POST /api/v1/images/push
 *
 * Receives a Docker image tarball (gzipped) and loads it on the target server.
 * Query params: tag, server, service
 *
 * This is the server-side of `daoflow push` — streams a Docker save tarball
 * directly to the server and loads it via `docker load`.
 */
router.post("/push", async (req, res) => {
  const tag = (req.query.tag as string) ?? "daoflow-app:latest";
  const serverId = (req.query.server as string) ?? "";
  const serviceName = (req.query.service as string) ?? "";
  const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);

  const uploadDir = join(tmpdir(), "daoflow-uploads");
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  const tarPath = join(uploadDir, `${uploadId}.tar.gz`);
  const writeStream = createWriteStream(tarPath);

  try {
    await new Promise<void>((resolve, reject) => {
      req.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      req.on("error", reject);
    });

    const fileSize = statSync(tarPath).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);

    // Load image into Docker
    try {
      execSync(`docker load < ${tarPath}`, {
        timeout: 300_000, // 5 min timeout
        stdio: "pipe"
      });
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: "docker_load_failed",
        message: err.stderr?.toString() ?? "Failed to load Docker image",
        uploadId
      });
      return;
    }

    // Cleanup tarball
    try {
      execSync(`rm -f ${tarPath}`);
    } catch {
      /* ignore */
    }

    res.json({
      status: "ok",
      uploadId,
      tag,
      sizeMB: Number(sizeMB),
      serverId: serverId || null,
      serviceName: serviceName || null,
      message: `Image ${tag} loaded successfully (${sizeMB} MB)`
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      error: "upload_failed",
      message: String(err)
    });
  }
});

/**
 * GET /api/v1/images
 *
 * List Docker images on the server.
 */
router.get("/", (_req, res) => {
  try {
    const output = execSync("docker images --format json", {
      timeout: 10_000,
      encoding: "utf-8"
    });

    const images = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    res.json({ images });
  } catch {
    res.json({ images: [] });
  }
});

export { router as imagesRouter };
