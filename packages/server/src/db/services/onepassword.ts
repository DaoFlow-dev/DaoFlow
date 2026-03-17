/**
 * 1Password service account integration.
 *
 * Uses the @1password/sdk to resolve op:// secret references
 * at deployment time. The SDK requires a service account token
 * (OP_SERVICE_ACCOUNT_TOKEN) which is stored encrypted in the
 * secret_providers table.
 *
 * Secret references use the format: op://vault/item/field
 */

import { eq, and } from "drizzle-orm";
import { db } from "../connection";
import { encrypt, decrypt } from "../crypto";
import { secretProviders } from "../schema/secret-providers";
import { auditEntries } from "../schema/audit";
import { randomBytes } from "node:crypto";

/** Validates that a string looks like a 1Password secret reference */
const OP_REF_PATTERN = /^op:\/\/[^/]+\/[^/]+\/[^/]+$/;

export function isValidSecretRef(ref: string): boolean {
  return OP_REF_PATTERN.test(ref);
}

/** Parse op://vault/item/field into components */
export function parseSecretRef(ref: string): {
  vault: string;
  item: string;
  field: string;
} | null {
  const match = ref.match(/^op:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return { vault: match[1], item: match[2], field: match[3] };
}

function generateId(): string {
  return `sp_${randomBytes(12).toString("hex")}`;
}

// ── Provider CRUD ────────────────────────────────────────────

export interface CreateSecretProviderInput {
  name: string;
  type: "1password";
  serviceAccountToken: string;
  teamId: string;
  createdByUserId: string;
  createdByEmail: string;
}

export async function createSecretProvider(input: CreateSecretProviderInput) {
  const id = generateId();
  const configEncrypted = encrypt(
    JSON.stringify({ serviceAccountToken: input.serviceAccountToken })
  );

  const [provider] = await db
    .insert(secretProviders)
    .values({
      id,
      name: input.name,
      type: input.type,
      configEncrypted,
      teamId: input.teamId,
      createdByUserId: input.createdByUserId,
      status: "active",
      metadata: {}
    })
    .returning();

  // Audit trail
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.createdByUserId,
    actorEmail: input.createdByEmail,
    targetResource: `secret_provider/${id}`,
    action: "secret_provider.create",
    inputSummary: JSON.stringify({ name: input.name, type: input.type }),
    outcome: "success"
  });

  return provider;
}

export async function listSecretProviders(teamId: string) {
  const providers = await db
    .select({
      id: secretProviders.id,
      name: secretProviders.name,
      type: secretProviders.type,
      status: secretProviders.status,
      lastTestedAt: secretProviders.lastTestedAt,
      metadata: secretProviders.metadata,
      createdAt: secretProviders.createdAt
    })
    .from(secretProviders)
    .where(eq(secretProviders.teamId, teamId));

  return providers.map((provider) => {
    const metadata =
      provider.metadata && typeof provider.metadata === "object"
        ? (provider.metadata as Record<string, unknown>)
        : {};

    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      status: provider.status,
      lastTestedAt: provider.lastTestedAt,
      lastTestError:
        typeof metadata["lastTestError"] === "string" ? metadata["lastTestError"] : null,
      createdAt: provider.createdAt
    };
  });
}

export async function deleteSecretProvider(
  providerId: string,
  teamId: string,
  actorId: string,
  actorEmail: string
) {
  const [deleted] = await db
    .delete(secretProviders)
    .where(and(eq(secretProviders.id, providerId), eq(secretProviders.teamId, teamId)))
    .returning();

  if (deleted) {
    await db.insert(auditEntries).values({
      actorType: "user",
      actorId,
      actorEmail,
      targetResource: `secret_provider/${providerId}`,
      action: "secret_provider.delete",
      inputSummary: JSON.stringify({ name: deleted.name }),
      outcome: "success"
    });
  }

  return deleted ?? null;
}

// ── Resolution ───────────────────────────────────────────────

/**
 * Resolve a single op:// secret reference using the 1Password SDK.
 *
 * Dynamically imports @1password/sdk so it remains an optional dependency.
 * Returns the resolved plaintext value.
 */
export async function resolveSecretReference(
  serviceAccountToken: string,
  secretRef: string
): Promise<string> {
  if (!isValidSecretRef(secretRef)) {
    throw new Error(
      `Invalid secret reference format: ${secretRef}. Expected op://vault/item/field`
    );
  }

  try {
    // Dynamic import — @1password/sdk is an optional dependency
    const { createClient } = (await import("@1password/sdk")) as {
      createClient: (opts: {
        auth: string;
        integrationName: string;
        integrationVersion: string;
      }) => Promise<{
        secrets: { resolve: (ref: string) => Promise<string> };
      }>;
    };

    const client = await createClient({
      auth: serviceAccountToken,
      integrationName: "DaoFlow",
      integrationVersion: "1.0.0"
    });

    return await client.secrets.resolve(secretRef);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to resolve 1Password secret ${secretRef}: ${message}`);
  }
}

/**
 * Test whether a service account token is valid by attempting to
 * create a client. Returns { ok, error? }.
 */
export async function testConnection(serviceAccountToken: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const { createClient } = (await import("@1password/sdk")) as {
      createClient: (opts: {
        auth: string;
        integrationName: string;
        integrationVersion: string;
      }) => Promise<unknown>;
    };

    await createClient({
      auth: serviceAccountToken,
      integrationName: "DaoFlow",
      integrationVersion: "1.0.0"
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Test a stored provider's connection and update its status.
 */
export async function testProviderConnection(
  providerId: string,
  teamId: string
): Promise<{ ok: boolean; error?: string }> {
  const [provider] = await db
    .select()
    .from(secretProviders)
    .where(and(eq(secretProviders.id, providerId), eq(secretProviders.teamId, teamId)))
    .limit(1);

  if (!provider) {
    return { ok: false, error: "Provider not found" };
  }

  const config = JSON.parse(decrypt(provider.configEncrypted)) as {
    serviceAccountToken: string;
  };
  const result = await testConnection(config.serviceAccountToken);

  // Update status
  await db
    .update(secretProviders)
    .set({
      status: result.ok ? "active" : "disconnected",
      lastTestedAt: new Date(),
      metadata: {
        ...(provider.metadata && typeof provider.metadata === "object" ? provider.metadata : {}),
        lastTestError: result.ok ? null : (result.error ?? "Unknown 1Password connection failure")
      },
      updatedAt: new Date()
    })
    .where(eq(secretProviders.id, providerId));

  return result;
}

function maskResolvedValue(value: string): string {
  if (value.length <= 4) {
    return "*".repeat(Math.max(4, value.length));
  }

  return `${"*".repeat(Math.min(8, value.length - 2))}${value.slice(-2)}`;
}

export interface ResolvedEnvironmentSecret {
  key: string;
  secretRef: string;
  source: "1password";
  providerName: string;
  providerType: string;
  maskedValue: string | null;
  status: "resolved" | "unresolved";
  error?: string;
}

export async function resolveEnvironmentSecretInventory(
  environmentId: string,
  teamId: string
): Promise<ResolvedEnvironmentSecret[]> {
  const { environmentVariables } = await import("../schema/projects");
  const opVars = await db
    .select({
      key: environmentVariables.key,
      secretRef: environmentVariables.secretRef
    })
    .from(environmentVariables)
    .where(
      and(
        eq(environmentVariables.environmentId, environmentId),
        eq(environmentVariables.source, "1password")
      )
    );

  if (opVars.length === 0) {
    return [];
  }

  const [provider] = await db
    .select()
    .from(secretProviders)
    .where(and(eq(secretProviders.teamId, teamId), eq(secretProviders.type, "1password")))
    .limit(1);

  if (!provider) {
    return opVars
      .filter((variable): variable is { key: string; secretRef: string } =>
        Boolean(variable.secretRef)
      )
      .map((variable) => ({
        key: variable.key,
        secretRef: variable.secretRef,
        source: "1password" as const,
        providerName: "unconfigured",
        providerType: "1password",
        maskedValue: null,
        status: "unresolved" as const,
        error: "No 1Password provider configured for this team."
      }));
  }

  const config = JSON.parse(decrypt(provider.configEncrypted)) as {
    serviceAccountToken: string;
  };

  const resolvedSecrets: ResolvedEnvironmentSecret[] = [];
  for (const variable of opVars) {
    if (!variable.secretRef) {
      continue;
    }

    try {
      const value = await resolveSecretReference(config.serviceAccountToken, variable.secretRef);
      resolvedSecrets.push({
        key: variable.key,
        secretRef: variable.secretRef,
        source: "1password",
        providerName: provider.name,
        providerType: provider.type,
        maskedValue: maskResolvedValue(value),
        status: "resolved"
      });
    } catch (error) {
      resolvedSecrets.push({
        key: variable.key,
        secretRef: variable.secretRef,
        source: "1password",
        providerName: provider.name,
        providerType: provider.type,
        maskedValue: null,
        status: "unresolved",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return resolvedSecrets;
}

/**
 * Resolve all 1Password env vars for an environment.
 * Returns a map of key → resolved value.
 */
export async function resolveEnvironmentSecrets(
  environmentId: string,
  teamId: string
): Promise<Map<string, string>> {
  const inventory = await resolveEnvironmentSecretInventory(environmentId, teamId);
  const resolved = new Map<string, string>();
  for (const item of inventory) {
    resolved.set(
      item.key,
      item.status === "resolved" && item.maskedValue
        ? item.maskedValue
        : `[UNRESOLVED: ${item.secretRef}]`
    );
  }

  return resolved;
}
