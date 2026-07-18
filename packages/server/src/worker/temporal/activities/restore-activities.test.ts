import { describe, expect, it } from "vitest";
import { restoreActivityTestHooks } from "./restore-activities";

describe("restore activity compatibility", () => {
  it("normalizes a mode-less legacy test restore before isolated verification", () => {
    const context = {
      backupType: "database",
      mode: undefined,
      targetPath: "/tmp/daoflow-restore/brun_legacy"
    } as const;

    expect(restoreActivityTestHooks.resolvePostgresRestoreVerificationContext(context)).toEqual({
      ...context,
      mode: "verification"
    });
  });

  it("keeps a mode-less legacy normal restore on the normal restore path", () => {
    expect(
      restoreActivityTestHooks.resolvePostgresRestoreVerificationContext({
        backupType: "database",
        mode: undefined,
        targetPath: "/var/lib/postgresql/data"
      })
    ).toBeNull();
  });
});
