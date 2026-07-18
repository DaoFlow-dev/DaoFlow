import { describe, expect, test } from "vitest";
import { resolveAuthSecret } from "./auth-secret";

describe("auth secret configuration", () => {
  test("requires an auth secret in production", () => {
    expect(() => resolveAuthSecret({ NODE_ENV: "production" })).toThrow(
      "BETTER_AUTH_SECRET must be set in production."
    );
  });

  test("requires a strong auth secret in production", () => {
    expect(() =>
      resolveAuthSecret({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "short-secret"
      })
    ).toThrow("BETTER_AUTH_SECRET must be at least 32 characters in production.");
  });

  test("allows local development fallback when no auth secret is configured", () => {
    expect(resolveAuthSecret({ NODE_ENV: "development" })).toBe(
      "daoflow-local-dev-secret-please-change-2026"
    );
  });
});
