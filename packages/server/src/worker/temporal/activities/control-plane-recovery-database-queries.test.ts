import { describe, expect, it } from "vitest";

import { controlPlaneRecoveryDatabaseQueryTestHooks } from "./control-plane-recovery-database-queries";

describe("control-plane recovery database queries", () => {
  it("reads the Drizzle migration journal from its dedicated schema", () => {
    expect(controlPlaneRecoveryDatabaseQueryTestHooks.migrationJournalSql).toContain(
      "FROM drizzle.__drizzle_migrations"
    );
  });

  it("verifies every known plaintext or ephemeral secret store after sanitization", () => {
    const sql = controlPlaneRecoveryDatabaseQueryTestHooks.sanitizedStateSql;

    expect(sql).toContain("notification_channels WHERE webhook_url IS NOT NULL");
    expect(sql).toContain("FROM push_subscriptions");
    expect(sql).toContain("FROM two_factor");
    expect(sql).toContain("users WHERE two_factor_enabled OR mfa_enrolled_at IS NOT NULL");
  });
});
