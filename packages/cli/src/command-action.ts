import type { Command } from "commander";
import chalk from "chalk";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  isRecord,
  resolveCommandJsonOption
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
}

export interface CommandActionContext {
  isJson: boolean;
  success<T>(
    data: T,
    options?: {
      exitCode?: number;
      json?: unknown;
      human?: () => void;
    }
  ): CommandActionResult<T>;
  complete(options?: {
    exitCode?: number;
    json?: unknown;
    human?: () => void;
  }): CommandActionResult;
  dryRun<T>(
    data: T,
    options?: {
      json?: unknown;
      human?: () => void;
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

function toCommandActionError(error: unknown): CommandActionError {
  if (error instanceof CommandActionError) {
    return error;
  }

  if (isRecord(error) && error instanceof Error) {
    const code = typeof error.code === "string" ? error.code : "ERROR";
    const exitCode = typeof error.exitCode === "number" ? error.exitCode : 1;
    const extra = isRecord(error.extra) ? error.extra : undefined;
    const humanMessage = typeof error.humanMessage === "string" ? error.humanMessage : undefined;
    return new CommandActionError(error.message, {
      code,
      exitCode,
      extra,
      humanMessage
    });
  }

  return new CommandActionError(getErrorMessage(error), {
    code: "ERROR"
  });
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
  const ctx: CommandActionContext = {
    isJson,
    success(data, options) {
      return {
        data,
        exitCode: options?.exitCode,
        json: options?.json,
        human: options?.human
      };
    },
    complete(options) {
      return {
        exitCode: options?.exitCode,
        json: options?.json,
        human: options?.human
      };
    },
    dryRun(data, options) {
      return {
        data,
        exitCode: 3,
        json: options?.json,
        human: options?.human
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
    result = await input.action(ctx);
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
  } else if (result.human) {
    result.human();
  } else if (result.data !== undefined && input.renderHumanSuccess) {
    input.renderHumanSuccess(result.data);
  }

  if (result.exitCode !== undefined) {
    process.exit(result.exitCode);
  }
}
