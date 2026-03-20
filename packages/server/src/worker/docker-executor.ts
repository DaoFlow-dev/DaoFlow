import { spawn, type ChildProcess } from "node:child_process";
import { parseComposePsOutput, type ComposeContainerStatus } from "./compose-health";
import { formatComposeExecutionEnvSummary, prepareComposeCommandEnv } from "./compose-command-env";

export {
  ensureStagingDir,
  getStagingArchivePath,
  cleanupStagingDir,
  gitClone,
  prepareClonedRepository,
  type GitCloneOptions
} from "./git-executor";
export { buildComposeCommandEnv } from "./compose-command-env";

const STAGING_DIR = process.env.GIT_WORK_DIR ?? "/tmp/daoflow-staging";
const COMPOSE_BUILD_ENV = {
  DOCKER_BUILDKIT: "1",
  COMPOSE_DOCKER_CLI_BUILD: "1"
} as const;

export type LogLine = {
  stream: "stdout" | "stderr";
  message: string;
  timestamp: Date;
};

export type OnLog = (line: LogLine) => void;
type ExecRunner = typeof execStreaming;

export interface ExecStreamingOptions {
  inheritParentEnv?: boolean;
}

function normalizeComposeFiles(composeFiles: string | string[]): string[] {
  return Array.isArray(composeFiles) ? composeFiles : [composeFiles];
}

function appendComposeArgs(
  args: string[],
  composeFiles: string | string[],
  composeProfiles?: string[]
) {
  for (const composeFile of normalizeComposeFiles(composeFiles)) {
    args.push("-f", composeFile);
  }

  for (const profile of composeProfiles ?? []) {
    const normalizedProfile = profile.trim();
    if (normalizedProfile.length > 0) {
      args.push("--profile", normalizedProfile);
    }
  }
}

export function execStreaming(
  command: string,
  args: string[],
  cwd: string,
  onLog: OnLog,
  envOverrides?: Record<string, string>,
  options?: ExecStreamingOptions
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      const env =
        options?.inheritParentEnv === false
          ? (envOverrides ?? {})
          : { ...process.env, DOCKER_CLI_HINTS: "false", ...(envOverrides ?? {}) };
      child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const processStream = (stream: "stdout" | "stderr", data: Buffer) => {
      const text = data.toString("utf-8");
      for (const rawLine of text.split("\n")) {
        const message = rawLine.trimEnd();
        if (message.length > 0) {
          onLog({ stream, message, timestamp: new Date() });
        }
      }
    };

    child.stdout?.on("data", (data: Buffer) => processStream("stdout", data));
    child.stderr?.on("data", (data: Buffer) => processStream("stderr", data));

    child.on("close", (code, signal) => {
      resolve({ exitCode: code ?? 1, signal: signal ?? null });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

export async function dockerBuild(
  context: string,
  dockerfile: string,
  tag: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Building image ${tag} from ${dockerfile}`,
    timestamp: new Date()
  });

  return execStreaming("docker", ["build", "-t", tag, "-f", dockerfile, "."], context, onLog);
}

export async function dockerComposePull(
  composeFiles: string | string[],
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  composeProfilesOrExecRunner?: string[] | ExecRunner,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  const composeProfiles = Array.isArray(composeProfilesOrExecRunner)
    ? composeProfilesOrExecRunner
    : undefined;
  const runner =
    typeof composeProfilesOrExecRunner === "function" ? composeProfilesOrExecRunner : execRunner;
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Pulling images for compose project ${projectName} (service: ${scopedServiceName})`
      : `Pulling images for compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose"];
  appendComposeArgs(args, composeFiles, composeProfiles);
  args.push("-p", projectName);
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("pull", "--ignore-buildable");
  if (scopedServiceName) {
    args.push("--include-deps");
    args.push(scopedServiceName);
  }

  return runner("docker", args, cwd, onLog, composeExecutionEnv.env, {
    inheritParentEnv: false
  });
}

export async function dockerComposeBuild(
  composeFiles: string | string[],
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  composeProfilesOrExecRunner?: string[] | ExecRunner,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  const composeProfiles = Array.isArray(composeProfilesOrExecRunner)
    ? composeProfilesOrExecRunner
    : undefined;
  const runner =
    typeof composeProfilesOrExecRunner === "function" ? composeProfilesOrExecRunner : execRunner;
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Building compose project ${projectName} (service: ${scopedServiceName})`
      : `Building compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose"];
  appendComposeArgs(args, composeFiles, composeProfiles);
  args.push("-p", projectName);
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("build");
  if (scopedServiceName) {
    args.push("--with-dependencies");
    args.push(scopedServiceName);
  }

  return runner(
    "docker",
    args,
    cwd,
    onLog,
    { ...composeExecutionEnv.env, ...COMPOSE_BUILD_ENV },
    {
      inheritParentEnv: false
    }
  );
}

export async function dockerComposeUp(
  composeFiles: string | string[],
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  composeProfilesOrExecRunner?: string[] | ExecRunner,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  const composeProfiles = Array.isArray(composeProfilesOrExecRunner)
    ? composeProfilesOrExecRunner
    : undefined;
  const runner =
    typeof composeProfilesOrExecRunner === "function" ? composeProfilesOrExecRunner : execRunner;
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Starting compose project ${projectName} (service: ${scopedServiceName})`
      : `Starting compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose"];
  appendComposeArgs(args, composeFiles, composeProfiles);
  args.push("-p", projectName);
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("up", "-d", "--remove-orphans");
  if (scopedServiceName) {
    args.push(scopedServiceName);
  }

  return runner("docker", args, cwd, onLog, composeExecutionEnv.env, {
    inheritParentEnv: false
  });
}

export async function dockerComposePs(
  composeFiles: string | string[],
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  composeProfilesOrExecRunner?: string[] | ExecRunner,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; statuses: ComposeContainerStatus[] }> {
  const composeProfiles = Array.isArray(composeProfilesOrExecRunner)
    ? composeProfilesOrExecRunner
    : undefined;
  const runner =
    typeof composeProfilesOrExecRunner === "function" ? composeProfilesOrExecRunner : execRunner;
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  const args = ["compose"];
  appendComposeArgs(args, composeFiles, composeProfiles);
  args.push("-p", projectName);
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("ps", "--format", "json");

  const scopedServiceName = composeServiceName?.trim();
  if (scopedServiceName) {
    args.push(scopedServiceName);
  }

  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const stdoutLines: string[] = [];
  const result = await runner(
    "docker",
    args,
    cwd,
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    },
    composeExecutionEnv.env,
    { inheritParentEnv: false }
  );

  return {
    exitCode: result.exitCode,
    statuses: result.exitCode === 0 ? parseComposePsOutput(stdoutLines.join("\n")) : []
  };
}

export async function dockerComposeDown(
  composeFiles: string | string[],
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeProfilesOrExecRunner?: string[] | ExecRunner,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const composeProfiles = Array.isArray(composeProfilesOrExecRunner)
    ? composeProfilesOrExecRunner
    : undefined;
  const runner =
    typeof composeProfilesOrExecRunner === "function" ? composeProfilesOrExecRunner : execRunner;
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: `Stopping compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose"];
  appendComposeArgs(args, composeFiles, composeProfiles);
  args.push("-p", projectName);
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("down");

  return runner("docker", args, cwd, onLog, composeExecutionEnv.env, {
    inheritParentEnv: false
  });
}

export async function dockerRun(
  tag: string,
  containerName: string,
  options: { ports?: string[]; volumes?: string[]; env?: Record<string, string>; network?: string },
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const args = ["run", "-d", "--name", containerName, "--restart", "unless-stopped"];

  if (options.network) {
    args.push("--network", options.network);
  }
  for (const port of options.ports ?? []) {
    args.push("-p", port);
  }
  for (const volume of options.volumes ?? []) {
    args.push("-v", volume);
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(tag);

  onLog({
    stream: "stdout",
    message: `Running container ${containerName} from ${tag}`,
    timestamp: new Date()
  });

  return execStreaming("docker", args, STAGING_DIR, onLog);
}

export async function dockerPull(tag: string, onLog: OnLog): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Pulling image ${tag}`,
    timestamp: new Date()
  });

  return execStreaming("docker", ["pull", tag], STAGING_DIR, onLog);
}

export async function checkContainerHealth(containerName: string, onLog: OnLog): Promise<boolean> {
  let healthy = false;

  const result = await execStreaming(
    "docker",
    ["inspect", "--format", "{{.State.Status}}", containerName],
    STAGING_DIR,
    (line) => {
      onLog(line);
      if (line.message.trim() === "running") {
        healthy = true;
      }
    }
  );

  return result.exitCode === 0 && healthy;
}

export async function dockerRemoveContainer(
  containerName: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Removing container ${containerName}`,
    timestamp: new Date()
  });

  // Stop first, then remove
  await execStreaming("docker", ["stop", containerName], STAGING_DIR, onLog);
  return execStreaming("docker", ["rm", "-f", containerName], STAGING_DIR, onLog);
}

export async function dockerLoad(tarPath: string, onLog: OnLog): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Loading image from ${tarPath}`,
    timestamp: new Date()
  });

  return execStreaming("docker", ["load", "-i", tarPath], STAGING_DIR, onLog);
}

export async function dockerListImages(
  onLog: OnLog
): Promise<{ exitCode: number; images: DockerImageListEntry[] }> {
  let rawOutput = "";

  const result = await execStreaming(
    "docker",
    ["images", "--format", "json"],
    STAGING_DIR,
    (line) => {
      onLog(line);
      rawOutput += line.message + "\n";
    }
  );

  const images: DockerImageListEntry[] = rawOutput
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as DockerImageListEntry;
      } catch {
        return null;
      }
    })
    .filter((item): item is DockerImageListEntry => item !== null);

  return { exitCode: result.exitCode, images };
}

export async function detectLocalRuntimeVersions(
  onLog: OnLog
): Promise<{ docker?: string; compose?: string }> {
  const versions: { docker?: string; compose?: string } = {};

  await execStreaming(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    STAGING_DIR,
    (line) => {
      onLog(line);
      if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
        versions.docker = line.message.trim();
      }
    }
  );

  await execStreaming("docker", ["compose", "version", "--short"], STAGING_DIR, (line) => {
    onLog(line);
    if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
      versions.compose = line.message.trim();
    }
  });

  return versions;
}

export async function extractTarArchive(
  tarPath: string,
  destinationDir: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Extracting ${tarPath} into ${destinationDir}`,
    timestamp: new Date()
  });

  return execStreaming("tar", ["-xzf", tarPath, "-C", destinationDir], STAGING_DIR, onLog);
}

export async function createTarArchive(
  sourceDir: string,
  tarPath: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Archiving ${sourceDir} into ${tarPath}`,
    timestamp: new Date()
  });

  return execStreaming("tar", ["-czf", tarPath, "-C", sourceDir, "."], STAGING_DIR, onLog);
}

export interface DockerImageListEntry {
  Repository: string;
  Tag: string;
  ID: string;
  CreatedAt: string;
  Size: string;
}
