import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";

import { dockerCommand, withCommandPath } from "../../command-env";

const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_CAPTURED_BYTES = 1024 * 1024;

export async function dockerCapture(
  args: string[],
  operation: string,
  signal?: AbortSignal
): Promise<string> {
  return runDocker({ args, operation, signal, captureStdout: true });
}

export async function dockerWriteStdoutToFile(
  args: string[],
  outputPath: string,
  operation: string,
  signal?: AbortSignal
): Promise<void> {
  await runDocker({ args, operation, signal, stdoutPath: outputPath });
}

export async function dockerPipeFileToStdin(
  args: string[],
  inputPath: string,
  operation: string,
  signal?: AbortSignal
): Promise<void> {
  await runDocker({ args, operation, signal, stdinPath: inputPath });
}

function runDocker(input: {
  args: string[];
  operation: string;
  signal?: AbortSignal;
  stdinPath?: string;
  stdoutPath?: string;
  captureStdout?: boolean;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerCommand, input.args, {
      env: withCommandPath(process.env),
      stdio: [input.stdinPath ? "pipe" : "ignore", "pipe", "pipe"]
    });
    let output = "";
    let settled = false;
    let inputStream: ReturnType<typeof createReadStream> | undefined;
    let outputStream: ReturnType<typeof createWriteStream> | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      inputStream?.destroy();
      callback();
    };
    const fail = () => finish(() => reject(new Error(`Unable to ${input.operation}.`)));
    const abort = () => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("Control-plane recovery was cancelled.")));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`Timed out while attempting to ${input.operation}.`)));
    }, COMMAND_TIMEOUT_MS);

    child.on("error", fail);
    child.stderr?.resume();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!input.captureStdout) return;
      output += chunk.toString();
      if (output.length > MAX_CAPTURED_BYTES) child.kill("SIGTERM");
    });
    child.on("close", (code) => {
      const complete = () => (code === 0 ? finish(() => resolve(output)) : fail());
      if (outputStream && !outputStream.writableFinished) {
        outputStream.once("finish", complete);
        outputStream.once("error", fail);
      } else {
        complete();
      }
    });

    if (input.stdoutPath && child.stdout) {
      outputStream = createWriteStream(input.stdoutPath, { mode: 0o600 });
      outputStream.on("error", () => {
        child.kill("SIGTERM");
        fail();
      });
      child.stdout.pipe(outputStream);
    }
    if (input.stdinPath && child.stdin) {
      inputStream = createReadStream(input.stdinPath);
      inputStream.on("error", () => child.kill("SIGTERM"));
      child.stdin.on("error", () => child.kill("SIGTERM"));
      inputStream.pipe(child.stdin);
    }
    if (input.signal?.aborted) {
      abort();
    } else {
      input.signal?.addEventListener("abort", abort, { once: true });
    }
  });
}
