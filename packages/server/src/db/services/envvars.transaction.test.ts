import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { secretProviders } from "../schema/secret-providers";
import {
  prepareComposeDeploymentEnvState,
  resolveComposeDeploymentEnvEntries
} from "./compose-env";
import {
  deleteEnvironmentVariable,
  listEnvironmentVariableInventory,
  upsertEnvironmentVariable
} from "./envvars";
import { createService } from "./services";
import { resolveTeamIdForUser } from "./teams";
import { resetSeededTestDatabase } from "../../test-db";

const actor = {
  updatedByUserId: "user_developer",
  updatedByEmail: "developer@daoflow.local",
  updatedByRole: "developer" as const
};

function nextKey(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function targetResource(key: string) {
  return `env-var/environment/env_daoflow_staging/${key}`;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function installAuditFailureTrigger(resource: string) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `envvar_audit_failure_${suffix}`;
  const triggerName = `envvar_audit_failure_${suffix}`;
  const quotedFunctionName = quoteIdentifier(functionName);
  const quotedTriggerName = quoteIdentifier(triggerName);

  await db.execute(
    sql.raw(`
      CREATE FUNCTION ${quotedFunctionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.target_resource = '${resource}' THEN
          RAISE EXCEPTION 'forced environment variable audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `)
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${quotedTriggerName}
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION ${quotedFunctionName}();
    `)
  );

  return async () => {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${quotedTriggerName} ON audit_entries;`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${quotedFunctionName}();`));
  };
}

describe("environment variable mutation transactions", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
  });

  it("serializes concurrent updates and issues non-repeating revisions after recreate", async () => {
    const key = nextKey("REVISION_SECRET");
    const secretValues = [
      "initial-secret",
      ...Array.from({ length: 8 }, (_, index) => `secret-${index}`)
    ];
    const created = await upsertEnvironmentVariable({
      ...actor,
      environmentId: "env_daoflow_staging",
      key,
      value: secretValues[0] ?? "initial-secret",
      isSecret: true,
      category: "runtime"
    });
    if (!created) throw new Error("Expected environment variable creation to succeed.");

    const updates = await Promise.all(
      secretValues.slice(1).map((value) =>
        upsertEnvironmentVariable({
          ...actor,
          environmentId: "env_daoflow_staging",
          key,
          value,
          isSecret: true,
          category: "runtime"
        })
      )
    );
    const updateRevisions = updates.map((result) => {
      if (!result) throw new Error("Expected concurrent environment variable update to succeed.");
      return result.revision;
    });
    const revisions = [created.revision, ...updateRevisions];

    expect(revisions.every((revision) => Number.isInteger(revision))).toBe(true);
    expect(new Set(revisions)).toHaveLength(revisions.length);

    const deleted = await deleteEnvironmentVariable({
      environmentId: "env_daoflow_staging",
      key,
      deletedByUserId: actor.updatedByUserId,
      deletedByEmail: actor.updatedByEmail,
      deletedByRole: actor.updatedByRole
    });
    expect(deleted?.revision).toBe(Math.max(...revisions));

    const recreated = await upsertEnvironmentVariable({
      ...actor,
      environmentId: "env_daoflow_staging",
      key,
      value: "recreated-secret",
      isSecret: true,
      category: "runtime"
    });
    expect(recreated?.revision).toBeGreaterThan(Math.max(...revisions));

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, targetResource(key)));
    const auditText = JSON.stringify(entries.map((entry) => entry.metadata));

    expect(entries).toHaveLength(secretValues.length + 2);
    for (const secretValue of [...secretValues, "recreated-secret"]) {
      expect(auditText).not.toContain(secretValue);
    }
    expect(auditText).toContain("[secret]");
  });

  it("rolls back update and delete when the matching audit insert fails", async () => {
    const key = nextKey("ATOMIC_MUTATION");
    const initial = await upsertEnvironmentVariable({
      ...actor,
      environmentId: "env_daoflow_staging",
      key,
      value: "before-audit-failure",
      isSecret: false,
      category: "runtime"
    });
    if (!initial) throw new Error("Expected environment variable creation to succeed.");

    const removeTrigger = await installAuditFailureTrigger(targetResource(key));
    try {
      await expect(
        upsertEnvironmentVariable({
          ...actor,
          environmentId: "env_daoflow_staging",
          key,
          value: "after-audit-failure",
          isSecret: false,
          category: "runtime"
        })
      ).rejects.toThrow("Failed query");
      await expect(
        deleteEnvironmentVariable({
          environmentId: "env_daoflow_staging",
          key,
          deletedByUserId: actor.updatedByUserId,
          deletedByEmail: actor.updatedByEmail,
          deletedByRole: actor.updatedByRole
        })
      ).rejects.toThrow("Failed query");
    } finally {
      await removeTrigger();
    }

    const teamId = await resolveTeamIdForUser(actor.updatedByUserId);
    if (!teamId) throw new Error("Expected foundation team.");
    const inventory = await listEnvironmentVariableInventory({
      teamId,
      environmentId: "env_daoflow_staging",
      canRevealSecrets: true
    });
    expect(inventory.variables.find((variable) => variable.key === key)?.displayValue).toBe(
      "before-audit-failure"
    );

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, targetResource(key)));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toMatchObject({
      redactedDiff: { after: { revision: initial.revision } }
    });
  });

  it("resolves winning project, environment, and service 1Password values only into encrypted deployment state", async () => {
    const teamId = await resolveTeamIdForUser(actor.updatedByUserId);
    if (!teamId) throw new Error("Expected foundation team.");
    await db.insert(secretProviders).values({
      id: `sp_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      name: "test-1password",
      type: "1password",
      configEncrypted: encrypt(JSON.stringify({ serviceAccountToken: "test-service-token" })),
      teamId,
      createdByUserId: actor.updatedByUserId,
      status: "active",
      metadata: {}
    });

    const serviceResult = await createService({
      name: `onepassword-${Date.now()}`,
      environmentId: "env_daoflow_staging",
      projectId: "proj_daoflow_control_plane",
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      requestedByUserId: actor.updatedByUserId,
      requestedByEmail: actor.updatedByEmail,
      requestedByRole: actor.updatedByRole
    });
    if (serviceResult.status !== "ok") {
      throw new Error("Expected 1Password fixture service creation to succeed.");
    }

    await upsertEnvironmentVariable({
      ...actor,
      projectId: "proj_daoflow_control_plane",
      scope: "project",
      key: "PROJECT_ONEPASSWORD",
      value: "project-placeholder",
      isSecret: false,
      category: "runtime",
      source: "1password",
      secretRef: "op://dao/project/project"
    });
    await upsertEnvironmentVariable({
      ...actor,
      environmentId: "env_daoflow_staging",
      key: "ENVIRONMENT_ONEPASSWORD",
      value: "environment-placeholder",
      isSecret: false,
      category: "runtime",
      source: "1password",
      secretRef: "op://dao/environment/environment"
    });
    await upsertEnvironmentVariable({
      ...actor,
      environmentId: "env_daoflow_staging",
      serviceId: serviceResult.service.id,
      scope: "service",
      key: "SERVICE_ONEPASSWORD",
      value: "service-placeholder",
      isSecret: false,
      category: "runtime",
      source: "1password",
      secretRef: "op://dao/service/service"
    });

    const entries = await resolveComposeDeploymentEnvEntries({
      environmentId: "env_daoflow_staging",
      serviceId: serviceResult.service.id,
      branch: "main",
      resolveOnePasswordSecretReference: (_serviceAccountToken, reference) =>
        Promise.resolve(`resolved-${reference.split("/").at(-1) ?? "value"}`)
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "PROJECT_ONEPASSWORD",
          value: "resolved-project",
          source: "1password",
          isSecret: true,
          origin: "project"
        }),
        expect.objectContaining({
          key: "ENVIRONMENT_ONEPASSWORD",
          value: "resolved-environment",
          source: "1password",
          isSecret: true,
          origin: "environment"
        }),
        expect.objectContaining({
          key: "SERVICE_ONEPASSWORD",
          value: "resolved-service",
          source: "1password",
          isSecret: true,
          origin: "service"
        })
      ])
    );

    const state = await prepareComposeDeploymentEnvState({
      environmentId: "env_daoflow_staging",
      serviceId: serviceResult.service.id,
      branch: "main",
      resolveOnePasswordSecretReference: (_serviceAccountToken, reference) =>
        Promise.resolve(`resolved-${reference.split("/").at(-1) ?? "value"}`)
    });
    const evidence = JSON.stringify(state.composeEnv);

    expect(state.envVarsEncrypted).not.toContain("resolved-project");
    expect(state.envVarsEncrypted).not.toContain("resolved-environment");
    expect(state.envVarsEncrypted).not.toContain("resolved-service");
    expect(evidence).not.toContain("resolved-project");
    expect(evidence).not.toContain("resolved-environment");
    expect(evidence).not.toContain("resolved-service");
    expect(evidence).toContain("[secret]");
  });
});
