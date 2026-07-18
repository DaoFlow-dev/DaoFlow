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
      runMigrations: () => Promise.resolve(),
      runCredentialMigration: () =>
        Promise.resolve({ scanned: 0, migrated: 0, rotated: 0, verified: 0 })
    });

    const migrations = getStartupReadiness().checks.find((check) => check.name === "migrations");
    expect(migrations).toMatchObject({
      status: "ok",
      detail:
        "Database migrations completed. Backup-destination credentials: 0 migrated, 0 rotated, 0 verified."
    });
  });

  it("fails fast on production migration errors by default", async () => {
    await expect(
      runStartupMigrations({
        isProduction: true,
        runMigrations: () => Promise.reject(new Error("schema drift")),
        runCredentialMigration: () =>
          Promise.resolve({ scanned: 0, migrated: 0, rotated: 0, verified: 0 })
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
    const runCredentialMigration = vi
      .fn()
      .mockResolvedValue({ scanned: 1, migrated: 1, rotated: 0, verified: 1 });

    await expect(
      runStartupMigrations({
        isProduction: true,
        allowFailure: true,
        runMigrations: () => Promise.reject(new Error("manual bypass")),
        runCredentialMigration
      })
    ).resolves.toBeUndefined();

    expect(runCredentialMigration).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith("[migrate] Auto-migration failed:", "manual bypass");
    expect(consoleWarn).toHaveBeenCalled();
    expect(getStartupReadiness().ready).toBe(false);
  });

  it("does not let the schema-migration bypass skip credential safety", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      runStartupMigrations({
        isProduction: true,
        allowFailure: true,
        runMigrations: () => Promise.reject(new Error("schema migration unavailable")),
        runCredentialMigration: () => Promise.reject(new Error("destination key mismatch"))
      })
    ).rejects.toThrow("destination key mismatch");

    const migrations = getStartupReadiness().checks.find((check) => check.name === "migrations");
    expect(migrations).toMatchObject({
      status: "failed",
      detail: "Backup-destination credential migration failed: destination key mismatch"
    });
  });

  it("never bypasses backup-destination credential migration failures in production", async () => {
    await expect(
      runStartupMigrations({
        isProduction: true,
        allowFailure: true,
        runMigrations: () => Promise.resolve(),
        runCredentialMigration: () => Promise.reject(new Error("destination key mismatch"))
      })
    ).rejects.toThrow("destination key mismatch");

    const migrations = getStartupReadiness().checks.find((check) => check.name === "migrations");
    expect(migrations).toMatchObject({
      status: "failed",
      detail: "Backup-destination credential migration failed: destination key mismatch"
    });
  });
});
