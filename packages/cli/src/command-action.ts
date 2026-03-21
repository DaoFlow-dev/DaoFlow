import type { Command } from "commander";
import chalk from "chalk";
import { ApiError } from "./api-client";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  isRecord,
  resolveCommandIdempotencyKey,
  resolveCommandJsonOption,
  resolveCommandQuietOption,
  resolveCommandTimeoutMs,
  withCommandRequestOptions
} from "./command-helpers";

export class CommandActionError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly extra?: Record<string, unknown>;
  readonly humanMessage?: string;

  constructor(
    message: string,
    options?: {
      code?: string;
      exitCode?: number;
      extra?: Record<string, unknown>;
      humanMessage?: string;
    }
  ) {
    super(message);
    this.name = "CommandActionError";
    this.code = options?.code ?? "ERROR";
    this.exitCode = options?.exitCode ?? 1;
    this.extra = options?.extra;
    this.humanMessage = options?.humanMessage;
  }
}

export interface CommandActionResult<T = unknown> {
  data?: T;
  exitCode?: number;
  json?: unknown;
  human?: () => void;
  quiet?: string | string[] | (() => string | string[] | void);
}

export interface CommandActionContext {
  isJson: boolean;
  isQuiet: boolean;
  timeoutMs: number;
  idempotencyKey?: string;
  success<T>(
    data: T,
    options?: {
      exitCode?: number;
      json?: unknown;
      human?: () => void;
      quiet?: string | string[] | (() => string | string[] | void);
    }
  ): CommandActionResult<T>;
  complete(options?: {
    exitCode?: number;
    json?: unknown;
    human?: () => void;
    quiet?: string | string[] | (() => string | string[] | void);
  }): CommandActionResult;
  dryRun<T>(
    data: T,
    options?: {
      json?: unknown;
      human?: () => void;
      quiet?: string | string[] | (() => string | string[] | void);
    }
  ): CommandActionResult<T>;
  fail(
    message: string,
    options?: {
      code?: string;
      exitCode?: number;
      extra?: Record<string, unknown>;
      humanMessage?: string;
    }
  ): never;
  requireConfirmation(
    confirmed: boolean,
    message: string,
    options?: {
      code?: string;
      exitCode?: number;
      extra?: Record<string, unknown>;
      humanMessage?: string;
    }
  ): void;
}

function buildScopeDeniedExtra(
  cause: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!cause) {
    return undefined;
  }

  const extra: Record<string, unknown> = {};
  if (Array.isArray(cause.requiredScopes)) {
    extra.requiredScopes = cause.requiredScopes;
  }
  if (typeof cause.requiredScope === "string") {
    extra.requiredScope = cause.requiredScope;
  }
  if (Array.isArray(cause.grantedScopes)) {
    extra.grantedScopes = cause.grantedScopes;
  }

  return Object.keys(extra).length > 0 ? extra : undefined;
}

function resolveStructuredErrorParts(error: unknown): {
  code?: string;
  message?: string;
  extra?: Record<string, unknown>;
  exitCode?: number;
} {
  if (error instanceof ApiError) {
    let parsedBody: Record<string, unknown> | undefined;
    try {
      const body = JSON.parse(error.body) as unknown;
      if (isRecord(body)) {
        parsedBody = body;
      }
    } catch {
      // ignore non-JSON API bodies
    }

    const bodyCode = typeof parsedBody?.code === "string" ? parsedBody.code : undefined;
    const bodyMessage =
      typeof parsedBody?.error === "string"
        ? parsedBody.error
        : typeof parsedBody?.message === "string"
          ? parsedBody.message
          : undefined;

    return {
      code: bodyCode ?? (error.exitCode === 2 ? "API_AUTH_ERROR" : "API_ERROR"),
      message: bodyMessage,
      exitCode: error.exitCode
    };
  }

  if (!isRecord(error)) {
    return {};
  }

  const topLevelCode = typeof error.code === "string" ? error.code : undefined;
  const data = isRecord(error.data)
    ? error.data
    : isRecord(error.shape) && isRecord(error.shape.data)
      ? error.shape.data
      : undefined;
  const cause = isRecord(data?.cause)
    ? data.cause
    : isRecord(error.cause)
      ? error.cause
      : undefined;
  const causeCode = typeof cause?.code === "string" ? cause.code : undefined;

  if (
    causeCode === "SCOPE_DENIED" ||
    topLevelCode === "FORBIDDEN" ||
    topLevelCode === "UNAUTHORIZED"
  ) {
    return {
      code: causeCode ?? topLevelCode ?? "AUTH_ERROR",
      exitCode: 2,
      extra: buildScopeDeniedExtra(cause)
    };
  }

  return {};
}

export function toCommandActionError(error: unknown): CommandActionError {
  if (error instanceof CommandActionError) {
    return error;
  }

  const structured = resolveStructuredErrorParts(error);
  const fallbackMessage = getErrorMessage(error);
  const message = structured.message ?? fallbackMessage;

  if (isRecord(error) && error instanceof Error) {
    const code = structured.code ?? (typeof error.code === "string" ? error.code : "ERROR");
    const exitCode =
      structured.exitCode ?? (typeof error.exitCode === "number" ? error.exitCode : 1);
    const extra = structured.extra ?? (isRecord(error.extra) ? error.extra : undefined);
    const humanMessage = typeof error.humanMessage === "string" ? error.humanMessage : undefined;
    return new CommandActionError(message, {
      code,
      exitCode,
      extra,
      humanMessage
    });
  }

  return new CommandActionError(message, {
    code: structured.code ?? "ERROR",
    exitCode: structured.exitCode ?? 1,
    extra: structured.extra
  });
}

function renderQuietOutput(quietValue: CommandActionResult["quiet"]): void {
  const resolvedValue = typeof quietValue === "function" ? quietValue() : quietValue;
  if (typeof resolvedValue === "string") {
    console.log(resolvedValue);
    return;
  }

  if (Array.isArray(resolvedValue)) {
    for (const line of resolvedValue) {
      console.log(line);
    }
  }
}

export async function runCommandAction<T>(input: {
  command: Command;
  json?: boolean;
  action: (ctx: CommandActionContext) => Promise<CommandActionResult<T> | void>;
  renderHumanSuccess?: (data: T) => void;
  renderJsonSuccess?: (data: T) => unknown;
  renderError?: (error: CommandActionError, ctx: { isJson: boolean }) => void;
}): Promise<void> {
  const isJson = resolveCommandJsonOption(input.command, input.json);
  const isQuiet = resolveCommandQuietOption(input.command);
  const timeoutMs = resolveCommandTimeoutMs(input.command);
  const idempotencyKey = resolveCommandIdempotencyKey(input.command);
  const ctx: CommandActionContext = {
    isJson,
    isQuiet,
    timeoutMs,
    idempotencyKey,
    success(data, options) {
      return {
        data,
        exitCode: options?.exitCode,
        json: options?.json,
        human: options?.human,
        quiet: options?.quiet
      };
    },
    complete(options) {
      return {
        exitCode: options?.exitCode,
        json: options?.json,
        human: options?.human,
        quiet: options?.quiet
      };
    },
    dryRun(data, options) {
      return {
        data,
        exitCode: 3,
        json: options?.json,
        human: options?.human,
        quiet: options?.quiet
      };
    },
    fail(message, options) {
      throw new CommandActionError(message, options);
    },
    requireConfirmation(confirmed, message, options) {
      if (!confirmed) {
        throw new CommandActionError(message, {
          code: options?.code ?? "CONFIRMATION_REQUIRED",
          exitCode: options?.exitCode ?? 1,
          extra: options?.extra,
          humanMessage: options?.humanMessage ?? message
        });
      }
    }
  };

  let result: CommandActionResult<T> | void;
  try {
    result = await withCommandRequestOptions({ timeoutMs, idempotencyKey }, async () => {
      return await input.action(ctx);
    });
  } catch (error) {
    const actionError = toCommandActionError(error);

    if (input.renderError) {
      input.renderError(actionError, { isJson });
    } else if (isJson) {
      emitJsonError(actionError.message, actionError.code, actionError.extra);
    } else {
      console.error(chalk.red(actionError.humanMessage ?? actionError.message));
    }

    process.exit(actionError.exitCode);
  }

  if (!result) {
    return;
  }

  if (isJson) {
    if (result.json !== undefined) {
      console.log(JSON.stringify(result.json));
    } else if (result.data !== undefined) {
      const payload = input.renderJsonSuccess
        ? input.renderJsonSuccess(result.data)
        : { ok: true, data: result.data };
      if (input.renderJsonSuccess) {
        console.log(JSON.stringify(payload));
      } else {
        emitJsonSuccess(result.data);
      }
    }
  } else if (isQuiet) {
    if (result.quiet !== undefined) {
      renderQuietOutput(result.quiet);
    } else if (
      typeof result.data === "string" ||
      typeof result.data === "number" ||
      typeof result.data === "boolean"
    ) {
      console.log(String(result.data));
    }
  } else if (result.human) {
    result.human();
  } else if (result.data !== undefined && input.renderHumanSuccess) {
    input.renderHumanSuccess(result.data);
  }

  if (result.exitCode !== undefined) {
    process.exit(result.exitCode);
  }
}
