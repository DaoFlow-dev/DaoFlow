import type { Command } from "commander";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getExecErrorMessage(error: unknown): string {
  if (isRecord(error) && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string") {
      return stderr;
    }
    if (stderr instanceof Buffer) {
      return stderr.toString();
    }
  }

  return getErrorMessage(error);
}

export function readCommandBooleanOption(command: Command, optionName: string): boolean {
  const options = command.optsWithGlobals();
  return isRecord(options) && options[optionName] === true;
}

export function resolveCommandBooleanOption(
  command: Command,
  optionName: string,
  localValue?: boolean
): boolean {
  return localValue ?? readCommandBooleanOption(command, optionName);
}

export function resolveCommandJsonOption(command: Command, localValue?: boolean): boolean {
  return resolveCommandBooleanOption(command, "json", localValue);
}

export function emitJsonSuccess<T>(data: T): void {
  console.log(JSON.stringify({ ok: true, data }));
}

export function emitJsonError(
  error: string,
  code = "ERROR",
  extra?: Record<string, unknown>
): void {
  console.log(JSON.stringify({ ok: false, error, code, ...extra }));
}
