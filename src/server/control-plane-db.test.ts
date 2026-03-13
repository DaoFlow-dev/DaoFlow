import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptEnvironmentValue,
  encryptEnvironmentValue,
  ensureControlPlaneReady,
  listEnvironmentVariableInventory,
  upsertEnvironmentVariable
} from "./control-plane-db";

describe("control-plane environment variables", () => {
  it("round-trips encrypted environment values", async () => {
    await ensureControlPlaneReady();
    const encrypted = encryptEnvironmentValue("super-secret-value");

    expect(encrypted).not.toContain("super-secret-value");
    expect(decryptEnvironmentValue(encrypted)).toBe("super-secret-value");
  });

  it("rejects malformed encrypted payloads", async () => {
    await ensureControlPlaneReady();

    expect(() => decryptEnvironmentValue("bad-payload")).toThrow(
      "Invalid encrypted environment payload."
    );
  });

  it("upserts scoped variables and keeps secret reads redacted", async () => {
    await ensureControlPlaneReady();
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

    const inventory = await listEnvironmentVariableInventory("env_daoflow_staging", 50);
    const matches = inventory.variables.filter((variable) => variable.key === key);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      displayValue: "[secret]",
      isSecret: true,
      branchPattern: "feature/*"
    });
  });
});
