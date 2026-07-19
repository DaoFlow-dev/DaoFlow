import { spawn } from "node:child_process";
import type { RealInfraConfig } from "./config";

const S3_TIMEOUT_MS = 60_000;

function rcloneArguments(config: RealInfraConfig, operation: string, path: string) {
  return [operation, `ri:${config.s3.bucket}/${path}`, "--s3-no-check-bucket"];
}

async function runRclone(
  config: RealInfraConfig,
  operation: string,
  path: string,
  capture = false
) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("rclone", rcloneArguments(config, operation, path), {
      env: { ...process.env, ...rcloneEnvironment(config) },
      stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"]
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), S3_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("S3 cleanup command could not start."));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error("S3 cleanup command failed without exposing target details."));
    });
  });
}

function rcloneEnvironment(config: RealInfraConfig): NodeJS.ProcessEnv {
  return {
    RCLONE_CONFIG_RI_TYPE: "s3",
    RCLONE_CONFIG_RI_PROVIDER: "Minio",
    RCLONE_CONFIG_RI_ACCESS_KEY_ID: config.s3.accessKey,
    RCLONE_CONFIG_RI_SECRET_ACCESS_KEY: config.s3.secretAccessKey,
    RCLONE_CONFIG_RI_ENDPOINT: config.s3.endpoint,
    RCLONE_CONFIG_RI_REGION: config.s3.region,
    RCLONE_CONFIG_RI_FORCE_PATH_STYLE: "true",
    RCLONE_CONFIG_RI_NO_CHECK_BUCKET: "true"
  };
}

export async function cleanupOwnedS3(config: RealInfraConfig) {
  await runRclone(config, "delete", config.s3.prefix);
  await runRclone(config, "rmdirs", config.s3.prefix);
}

export async function assertZeroOwnedS3(config: RealInfraConfig) {
  const output = await runRclone(config, "lsf", config.s3.prefix, true);
  const remainingObjects = output.trim();
  if (remainingObjects) {
    throw new Error(
      `Owned S3 prefix still contains objects after cleanup:\n${remainingObjects.slice(0, 2_000)}`
    );
  }
}
