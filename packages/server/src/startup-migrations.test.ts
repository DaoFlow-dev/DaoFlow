import { afterEach, describe, expect, it, vi } from "vitest";
import { getStartupReadiness, resetStartupReadiness } from "./startup-readiness";
import { runStartupMigrations } from "./startup-migrations";

describe("startup migrations", () => {
  afterEach(() => {
    resetStartupReadiness();
    vi.restoreAllMocks();
  });

  it("marks migrations ready before the server binds", async () => {
    await runStartupMigrations({
      isProduction: true,
      runMigrations: () => Promise.resolve()
    });

    const migrations = getStartupReadiness().checks.find((check) => check.name === "migrations");
    expect(migrations).toMatchObject({
      status: "ok",
      detail: "Database migrations completed."
    });
  });

  it("fails fast on production migration errors by default", async () => {
    await expect(
      runStartupMigrations({
        isProduction: true,
        runMigrations: () => Promise.reject(new Error("schema drift"))
      })
    ).rejects.toThrow("schema drift");

    const migrations = getStartupReadiness().checks.find((check) => check.name === "migrations");
    expect(migrations).toMatchObject({
      status: "failed",
      detail: "Database migrations failed: schema drift"
    });
  });

  it("allows an explicit emergency bypass for migration failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      runStartupMigrations({
        isProduction: true,
        allowFailure: true,
        runMigrations: () => Promise.reject(new Error("manual bypass"))
      })
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("[migrate] Auto-migration failed:", "manual bypass");
    expect(consoleWarn).toHaveBeenCalled();
    expect(getStartupReadiness().ready).toBe(false);
  });
});
