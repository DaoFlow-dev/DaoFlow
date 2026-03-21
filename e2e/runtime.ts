const DEFAULT_PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000";

function normalizeBaseUrl(input: string) {
  return new URL(input).origin;
}

export const PLAYWRIGHT_BASE_URL = normalizeBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_PLAYWRIGHT_BASE_URL
);

export const PLAYWRIGHT_HEALTHCHECK_URL = new URL("/trpc/health", PLAYWRIGHT_BASE_URL).toString();

export const PLAYWRIGHT_SESSION_URL = new URL(
  "/api/auth/get-session",
  PLAYWRIGHT_BASE_URL
).toString();
