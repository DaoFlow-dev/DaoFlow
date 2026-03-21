import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encrypt as encryptEnvironmentValue,
  decrypt as decryptEnvironmentValue
} from "./db/crypto";
import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { ensureControlPlaneReady } from "./db/services/seed";
import {
  listEnvironmentVariableInventory,
  upsertEnvironmentVariable,
  deleteEnvironmentVariable
} from "./db/services/envvars";
import { resolveTeamIdForUser } from "./db/services/teams";

describe("control-plane environment variables", () => {
  it("round-trips encrypted environment values", async () => {
    await ensureControlPlaneReady();
    const encrypted = encryptEnvironmentValue("super-secret-value");

    expect(encrypted).not.toContain("super-secret-value");
    expect(decryptEnvironmentValue(encrypted)).toBe("super-secret-value");
  });

  it("rejects malformed encrypted payloads", async () => {
    await ensureControlPlaneReady();

    expect(() => decryptEnvironmentValue("bad-payload")).toThrow("Invalid encrypted payload.");
  });

  it("upserts scoped variables and keeps secret reads redacted", async () => {
    await ensureControlPlaneReady();
    const teamId = await resolveTeamIdForUser("user_developer");
    if (!teamId) {
      throw new Error("Failed to resolve foundation team.");
    }
    const key = `TEST_SECRET_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

    const first = await upsertEnvironmentVariable({
      environmentId: "env_daoflow_staging",
      key,
      value: "initial-secret",
      isSecret: true,
      category: "runtime",
      branchPattern: "feature/*",
      updatedByUserId: "user_developer",
      updatedByEmail: "developer@daoflow.local",
      updatedByRole: "developer"
    });

    expect(first).toMatchObject({
      key,
      environmentId: "env_daoflow_staging",
      status: "created"
    });

    const second = await upsertEnvironmentVariable({
      environmentId: "env_daoflow_staging",
      key,
      value: "rotated-secret",
      isSecret: true,
      category: "runtime",
      branchPattern: "feature/*",
      updatedByUserId: "user_developer",
      updatedByEmail: "developer@daoflow.local",
      updatedByRole: "developer"
    });

    expect(second).toMatchObject({
      key,
      environmentId: "env_daoflow_staging",
      status: "updated"
    });

    const inventory = await listEnvironmentVariableInventory({
      teamId,
      environmentId: "env_daoflow_staging",
      limit: 50
    });
    const matches = inventory.variables.filter((variable) => variable.key === key);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      displayValue: "[secret]",
      isSecret: true,
      branchPattern: "feature/*"
    });

    const revealedInventory = await listEnvironmentVariableInventory({
      teamId,
      environmentId: "env_daoflow_staging",
      limit: 50,
      canRevealSecrets: true
    });
    const revealed = revealedInventory.variables.find((variable) => variable.key === key);

    expect(revealed?.displayValue).toBe("rotated-secret");
  });

  it("records redacted before and after metadata for env variable audits", async () => {
    await ensureControlPlaneReady();
    const teamId = await resolveTeamIdForUser("user_developer");
    if (!teamId) {
      throw new Error("Failed to resolve foundation team.");
    }
    const key = `TEST_AUDIT_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

    await upsertEnvironmentVariable({
      teamId,
      environmentId: "env_daoflow_staging",
      key,
      value: "initial-secret",
      isSecret: true,
      category: "runtime",
      updatedByUserId: "user_developer",
      updatedByEmail: "developer@daoflow.local",
      updatedByRole: "developer"
    });

    await upsertEnvironmentVariable({
      teamId,
      environmentId: "env_daoflow_staging",
      key,
      value: "rotated-secret",
      isSecret: true,
      category: "build",
      source: "1password",
      secretRef: "op://dao/staging/api-token",
      branchPattern: "preview/*",
      updatedByUserId: "user_developer",
      updatedByEmail: "developer@daoflow.local",
      updatedByRole: "developer"
    });

    await deleteEnvironmentVariable({
      teamId,
      environmentId: "env_daoflow_staging",
      key,
      deletedByUserId: "user_developer",
      deletedByEmail: "developer@daoflow.local",
      deletedByRole: "developer"
    });

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `env-var/env_daoflow_staging/${key}`))
      .orderBy(desc(auditEntries.id));

    expect(entries).toHaveLength(3);

    const [deletedEntry, updatedEntry, createdEntry] = entries;
    const deletedDiff = deletedEntry?.metadata as
      | { redactedDiff?: { before?: { value: string }; after: null } }
      | undefined;
    const updatedDiff = updatedEntry?.metadata as
      | {
          redactedDiff?: {
            before?: { value: string; category: string };
            after?: { value: string; category: string; secretRef: string | null };
            changedFields?: string[];
          };
        }
      | undefined;
    const createdDiff = createdEntry?.metadata as
      | { redactedDiff?: { before: null; after?: { value: string } } }
      | undefined;

    expect(createdDiff?.redactedDiff?.before).toBeNull();
    expect(createdDiff?.redactedDiff?.after?.value).toBe("[secret]");
    expect(updatedDiff?.redactedDiff?.before?.value).toBe("[secret]");
    expect(updatedDiff?.redactedDiff?.after?.value).toBe("[secret]");
    expect(updatedDiff?.redactedDiff?.before?.category).toBe("runtime");
    expect(updatedDiff?.redactedDiff?.after?.category).toBe("build");
    expect(updatedDiff?.redactedDiff?.after?.secretRef).toBe("op://dao/staging/api-token");
    expect(updatedDiff?.redactedDiff?.changedFields).toContain("value");
    expect(updatedDiff?.redactedDiff?.changedFields).toContain("category");
    expect(deletedDiff?.redactedDiff?.before?.value).toBe("[secret]");
    expect(deletedDiff?.redactedDiff?.after).toBeNull();
  });
});
