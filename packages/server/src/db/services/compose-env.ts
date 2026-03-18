import { asc, eq } from "drizzle-orm";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { deployments } from "../schema/deployments";
import { environmentVariables } from "../schema/projects";
import {
  buildMaterializedComposeEnvEvidence,
  buildQueuedComposeEnvEvidence,
  matchesComposeEnvBranchPattern,
  type ComposeEnvVariableCategory,
  type ComposeEnvEvidence,
  type ComposeEnvMaterializedEntry,
  type ComposeEnvPayloadEntry
} from "../../compose-env";
import { asRecord } from "./json-helpers";

function normalizeComposeEnvCategory(value: string): ComposeEnvVariableCategory {
  return value === "build" ? "build" : "runtime";
}

export type DeploymentComposeEnvState =
  | {
      kind: "queued";
      entries: ComposeEnvPayloadEntry[];
    }
  | {
      kind: "materialized";
      entries: ComposeEnvMaterializedEntry[];
    };

export async function resolveComposeDeploymentEnvEntries(input: {
  environmentId: string;
  branch: string;
}): Promise<ComposeEnvPayloadEntry[]> {
  const rows = await db
    .select()
    .from(environmentVariables)
    .where(eq(environmentVariables.environmentId, input.environmentId))
    .orderBy(asc(environmentVariables.key));

  return rows
    .filter((row) => matchesComposeEnvBranchPattern(row.branchPattern, input.branch))
    .map((row) => ({
      key: row.key,
      value: decrypt(row.valueEncrypted),
      category: normalizeComposeEnvCategory(row.category),
      isSecret: row.isSecret === "true",
      source: row.source === "1password" ? "1password" : "inline",
      branchPattern: row.branchPattern
    }));
}

export async function prepareComposeDeploymentEnvState(input: {
  environmentId: string;
  branch: string;
}): Promise<{
  envVarsEncrypted: string;
  composeEnv: ComposeEnvEvidence;
}> {
  const entries = await resolveComposeDeploymentEnvEntries(input);

  return {
    envVarsEncrypted: encrypt(JSON.stringify(entries)),
    composeEnv: buildQueuedComposeEnvEvidence(input.branch, entries)
  };
}

export function encryptComposeDeploymentEnvEntries(
  entries: ComposeEnvPayloadEntry[] | ComposeEnvMaterializedEntry[]
): string {
  return encrypt(JSON.stringify(entries));
}

export function readDeploymentComposeEnvState(
  envVarsEncrypted: string | null | undefined
): DeploymentComposeEnvState {
  if (!envVarsEncrypted) {
    return { kind: "queued", entries: [] };
  }

  const parsed = JSON.parse(decrypt(envVarsEncrypted)) as unknown;
  if (!Array.isArray(parsed)) {
    return { kind: "queued", entries: [] };
  }

  const materializedEntries: ComposeEnvMaterializedEntry[] = [];
  const queuedEntries: ComposeEnvPayloadEntry[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : null;
    const value = typeof record.value === "string" ? record.value : null;
    const isSecret = record.isSecret === true;
    const branchPattern = typeof record.branchPattern === "string" ? record.branchPattern : null;

    if (!key || value === null) {
      continue;
    }

    if (
      record.category === "default" ||
      record.source === "repo-default" ||
      record.origin === "repo-default" ||
      record.origin === "environment-variable"
    ) {
      materializedEntries.push({
        key,
        value,
        category:
          record.category === "build" || record.category === "runtime"
            ? record.category
            : "default",
        isSecret,
        source:
          record.source === "1password"
            ? "1password"
            : record.source === "repo-default"
              ? "repo-default"
              : "inline",
        branchPattern,
        origin: record.origin === "repo-default" ? "repo-default" : "environment-variable",
        overrodeRepoDefault: record.overrodeRepoDefault === true
      });
      continue;
    }

    queuedEntries.push({
      key,
      value,
      category: normalizeComposeEnvCategory(
        typeof record.category === "string" ? record.category : "runtime"
      ),
      isSecret,
      source: record.source === "1password" ? "1password" : "inline",
      branchPattern
    });
  }

  if (materializedEntries.length > 0) {
    return {
      kind: "materialized",
      entries: materializedEntries.sort((a, b) => a.key.localeCompare(b.key))
    };
  }

  return {
    kind: "queued",
    entries: queuedEntries
  };
}

export function readDeploymentComposeEnvEntries(
  envVarsEncrypted: string | null | undefined
): ComposeEnvPayloadEntry[] {
  const state = readDeploymentComposeEnvState(envVarsEncrypted);
  if (state.kind === "queued") {
    return state.entries;
  }

  return state.entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    category: entry.category === "build" ? "build" : "runtime",
    isSecret: entry.isSecret,
    source: entry.source === "1password" ? "1password" : "inline",
    branchPattern: entry.branchPattern
  }));
}

export function buildMaterializedDeploymentComposeEnvEvidence(input: {
  branch: string;
  entries: ComposeEnvMaterializedEntry[];
  warnings?: string[];
}): ComposeEnvEvidence {
  return buildMaterializedComposeEnvEvidence(input.branch, input.entries, input.warnings ?? []);
}

export async function persistDeploymentComposeEnvState(input: {
  deploymentId: string;
  envVarsEncrypted: string;
  composeEnv: ComposeEnvEvidence;
}): Promise<void> {
  const [deployment] = await db
    .select({ configSnapshot: deployments.configSnapshot })
    .from(deployments)
    .where(eq(deployments.id, input.deploymentId))
    .limit(1);

  const snapshot = asRecord(deployment?.configSnapshot);

  await db
    .update(deployments)
    .set({
      envVarsEncrypted: input.envVarsEncrypted,
      configSnapshot: {
        ...snapshot,
        composeEnv: input.composeEnv
      },
      updatedAt: new Date()
    })
    .where(eq(deployments.id, input.deploymentId));
}
