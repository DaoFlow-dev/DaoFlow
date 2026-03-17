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
      createdAt: secretProviders.createdAt
    })
    .from(secretProviders)
    .where(eq(secretProviders.teamId, teamId));

  return providers;
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
      updatedAt: new Date()
    })
    .where(eq(secretProviders.id, providerId));

  return result;
}

/**
 * Resolve all 1Password env vars for an environment.
 * Returns a map of key → resolved value.
 */
export async function resolveEnvironmentSecrets(
  environmentId: string,
  teamId: string
): Promise<Map<string, string>> {
  // Import the env vars that use 1password source
  const { environmentVariables } = await import("../schema/projects");
  const opVars = await db
    .select()
    .from(environmentVariables)
    .where(
      and(
        eq(environmentVariables.environmentId, environmentId),
        eq(environmentVariables.source, "1password")
      )
    );

  if (opVars.length === 0) return new Map();

  // Get the team's 1password provider
  const [provider] = await db
    .select()
    .from(secretProviders)
    .where(and(eq(secretProviders.teamId, teamId), eq(secretProviders.type, "1password")))
    .limit(1);

  if (!provider) {
    throw new Error("No 1Password provider configured for this team");
  }

  const config = JSON.parse(decrypt(provider.configEncrypted)) as {
    serviceAccountToken: string;
  };

  const resolved = new Map<string, string>();
  for (const v of opVars) {
    if (v.secretRef) {
      try {
        const value = await resolveSecretReference(config.serviceAccountToken, v.secretRef);
        resolved.set(v.key, value);
      } catch {
        // On failure, set error marker for this key
        resolved.set(v.key, `[UNRESOLVED: ${v.secretRef}]`);
      }
    }
  }

  return resolved;
}
