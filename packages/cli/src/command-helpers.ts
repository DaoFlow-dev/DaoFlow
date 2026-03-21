import { AsyncLocalStorage } from "node:async_hooks";
import type { Command } from "commander";

const SHELL_METACHAR_PATTERN = /[`$><|;&]/;
const PATH_TRAVERSAL_PATTERN = /(^|[\\/])\.\.($|[\\/])/;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CommandRequestOptions {
  timeoutMs: number;
  idempotencyKey?: string;
}

const commandRequestStorage = new AsyncLocalStorage<CommandRequestOptions>();

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

function readCommandOption<T>(command: Command, optionName: string): T | undefined {
  const options = command.optsWithGlobals();
  return isRecord(options) ? (options[optionName] as T | undefined) : undefined;
}

export function readCommandBooleanOption(command: Command, optionName: string): boolean {
  return readCommandOption(command, optionName) === true;
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

export function resolveCommandQuietOption(command: Command, localValue?: boolean): boolean {
  return resolveCommandBooleanOption(command, "quiet", localValue);
}

export function resolveCommandTimeoutMs(command: Command, localValue?: number): number {
  if (typeof localValue === "number" && Number.isFinite(localValue) && localValue > 0) {
    return Math.round(localValue);
  }

  const rawTimeout = readCommandOption<unknown>(command, "timeout");
  const parsedSeconds =
    typeof rawTimeout === "number"
      ? rawTimeout
      : typeof rawTimeout === "string"
        ? Number.parseFloat(rawTimeout)
        : DEFAULT_TIMEOUT_MS / 1000;

  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    throw new Error(`Invalid --timeout value: ${String(rawTimeout)}. Expected a positive number.`);
  }

  return Math.round(parsedSeconds * 1000);
}

function containsControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }

  return false;
}

export function normalizeCliInput(
  value: string,
  field: string,
  options?: {
    allowShellMetacharacters?: boolean;
    allowPathTraversal?: boolean;
    maxLength?: number;
  }
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} cannot be empty.`);
  }

  const maxLength = options?.maxLength ?? 256;
  if (trimmed.length > maxLength) {
    throw new Error(`${field} is too long (max ${maxLength} characters).`);
  }

  if (containsControlCharacters(trimmed)) {
    throw new Error(`${field} cannot include control characters.`);
  }

  if (!options?.allowShellMetacharacters && SHELL_METACHAR_PATTERN.test(trimmed)) {
    throw new Error(`${field} cannot include shell metacharacters.`);
  }

  if (!options?.allowPathTraversal && PATH_TRAVERSAL_PATTERN.test(trimmed)) {
    throw new Error(`${field} cannot include path traversal patterns.`);
  }

  return trimmed;
}

export function normalizeOptionalCliInput(
  value: string | undefined,
  field: string,
  options?: {
    allowShellMetacharacters?: boolean;
    allowPathTraversal?: boolean;
    maxLength?: number;
  }
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeCliInput(value, field, options);
}

export function resolveCommandIdempotencyKey(
  command: Command,
  localValue?: string
): string | undefined {
  const rawKey = localValue ?? readCommandOption<string>(command, "idempotencyKey");
  if (rawKey === undefined) {
    return undefined;
  }

  return normalizeCliInput(rawKey, "Idempotency key", {
    allowPathTraversal: true,
    maxLength: 200
  });
}

export function getCurrentCommandRequestOptions(): CommandRequestOptions {
  return (
    commandRequestStorage.getStore() ?? {
      timeoutMs: DEFAULT_TIMEOUT_MS
    }
  );
}

export async function withCommandRequestOptions<T>(
  options: CommandRequestOptions,
  action: () => Promise<T>
): Promise<T> {
  return await commandRequestStorage.run(options, action);
}

export async function withResolvedCommandRequestOptions<T>(
  command: Command,
  action: () => Promise<T>
): Promise<T> {
  return await withCommandRequestOptions(
    {
      timeoutMs: resolveCommandTimeoutMs(command),
      idempotencyKey: resolveCommandIdempotencyKey(command)
    },
    action
  );
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
