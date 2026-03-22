import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { withCommandPath } from "./command-env";

export const STAGING_DIR = process.env.GIT_WORK_DIR ?? "/tmp/daoflow-staging";

export type LogLine = {
  stream: "stdout" | "stderr";
  message: string;
  timestamp: Date;
};

export type OnLog = (line: LogLine) => void;

export interface ExecStreamingOptions {
  inheritParentEnv?: boolean;
}

/**
 * Run an arbitrary command and stream output line-by-line.
 * Returns the exit code (0 = success).
 */
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
      if (cwd === STAGING_DIR && !existsSync(cwd)) {
        mkdirSync(cwd, { recursive: true });
      }
      const env =
        options?.inheritParentEnv === false
          ? (envOverrides ?? {})
          : { ...process.env, DOCKER_CLI_HINTS: "false", ...(envOverrides ?? {}) };
      child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: withCommandPath(env)
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
