/**
 * Shared helpers for shaping MCP tool results from tRPC calls.
 */
export interface ToolResult {
  // Index signature mirrors the MCP SDK's CallToolResult (which is open/passthrough),
  // so these results are assignable to the SDK tool-callback return type.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string; [key: string]: unknown }>;
  isError?: boolean;
}

function jsonContent(value: unknown): ToolResult["content"] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

export function ok(data: unknown): ToolResult {
  return { content: jsonContent(data) };
}

export function fail(message: string, extra?: Record<string, unknown>): ToolResult {
  return {
    content: jsonContent({ ok: false, error: message, ...extra }),
    isError: true
  };
}

interface TrpcLikeError {
  message?: string;
  data?: { code?: string; httpStatus?: number };
  shape?: { data?: unknown };
}

function toFail(error: unknown): ToolResult {
  const err = error as TrpcLikeError;
  const message = typeof err?.message === "string" ? err.message : String(error);
  return fail(message, {
    code: err?.data?.code,
    httpStatus: err?.data?.httpStatus,
    details: err?.shape?.data
  });
}

/**
 * Execute a read/planning call, returning its result as JSON or a structured
 * error (including tRPC scope-denied codes) on failure.
 */
export async function runCall(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return toFail(error);
  }
}

/**
 * Guard a mutating command behind an explicit `confirm: true`, mirroring the
 * CLI's `--yes` requirement (charter §11). Returns a refusal result when the
 * caller has not confirmed, otherwise `null` to proceed.
 */
export function requireConfirm(confirm: boolean | undefined, action: string): ToolResult | null {
  if (confirm === true) {
    return null;
  }

  return fail(
    `Refused: "${action}" mutates infrastructure and requires "confirm": true. ` +
      `Inspect the corresponding plan/read tool first, then re-call with confirm enabled.`,
    { requiresConfirm: true, action }
  );
}
