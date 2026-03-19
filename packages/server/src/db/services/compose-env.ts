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
import type {
  ComposeInputManifest,
  FrozenComposeEnvFilePayload,
  FrozenComposeInputsPayload
} from "../../compose-inputs";
import type { ComposeBuildPlan } from "../../compose-build-plan";
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

export interface DeploymentComposeState {
  envState: DeploymentComposeEnvState;
  frozenInputs?: FrozenComposeInputsPayload;
}

interface SerializedComposeDeploymentState {
  version: 1;
  composeEnvEntries: Array<ComposeEnvPayloadEntry | ComposeEnvMaterializedEntry>;
  frozenInputs?: FrozenComposeInputsPayload;
}

function parseFrozenEnvFilePayloads(value: unknown): FrozenComposeEnvFilePayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (
      typeof record.path !== "string" ||
      typeof record.sourcePath !== "string" ||
      typeof record.contents !== "string"
    ) {
      return [];
    }

    const services = Array.isArray(record.services)
      ? record.services.filter((service): service is string => typeof service === "string")
      : [];

    return [
      {
        path: record.path,
        sourcePath: record.sourcePath,
        contents: record.contents,
        services
      } satisfies FrozenComposeEnvFilePayload
    ];
  });
}

function parseFrozenComposeInputsPayload(value: unknown): FrozenComposeInputsPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const composeFileRecord =
    record.composeFile &&
    typeof record.composeFile === "object" &&
    !Array.isArray(record.composeFile)
      ? (record.composeFile as Record<string, unknown>)
      : null;

  if (
    !composeFileRecord ||
    typeof composeFileRecord.path !== "string" ||
    typeof composeFileRecord.sourcePath !== "string" ||
    typeof composeFileRecord.contents !== "string"
  ) {
    return undefined;
  }

  return {
    composeFile: {
      path: composeFileRecord.path,
      sourcePath: composeFileRecord.sourcePath,
      contents: composeFileRecord.contents
    },
    envFiles: parseFrozenEnvFilePayloads(record.envFiles)
  };
}

export async function resolveComposeDeploymentEnvEntries(input: {
  environmentId: string;
  branch: string;
  additionalEntries?: ComposeEnvPayloadEntry[];
}): Promise<ComposeEnvPayloadEntry[]> {
  const rows = await db
    .select()
    .from(environmentVariables)
    .where(eq(environmentVariables.environmentId, input.environmentId))
    .orderBy(asc(environmentVariables.key));

  const resolved: ComposeEnvPayloadEntry[] = rows
    .filter((row) => matchesComposeEnvBranchPattern(row.branchPattern, input.branch))
    .map((row) => ({
      key: row.key,
      value: decrypt(row.valueEncrypted),
      category: normalizeComposeEnvCategory(row.category),
      isSecret: row.isSecret === "true",
      source: row.source === "1password" ? "1password" : "inline",
      branchPattern: row.branchPattern
    }));

  if (!input.additionalEntries?.length) {
    return resolved;
  }

  const merged = new Map(resolved.map((entry) => [entry.key, entry] as const));
  for (const entry of input.additionalEntries) {
    merged.set(entry.key, entry);
  }

  return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function prepareComposeDeploymentEnvState(input: {
  environmentId: string;
  branch: string;
  additionalEntries?: ComposeEnvPayloadEntry[];
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
  return encryptComposeDeploymentState({ envEntries: entries });
}

export function encryptComposeDeploymentState(input: {
  envEntries: ComposeEnvPayloadEntry[] | ComposeEnvMaterializedEntry[];
  frozenInputs?: FrozenComposeInputsPayload;
}): string {
  return encrypt(
    JSON.stringify({
      version: 1,
      composeEnvEntries: input.envEntries,
      ...(input.frozenInputs ? { frozenInputs: input.frozenInputs } : {})
    } satisfies SerializedComposeDeploymentState)
  );
}

export function readDeploymentComposeState(
  envVarsEncrypted: string | null | undefined
): DeploymentComposeState {
  if (!envVarsEncrypted) {
    return { envState: { kind: "queued", entries: [] } };
  }

  const parsed = JSON.parse(decrypt(envVarsEncrypted)) as unknown;

  const encryptedEntries = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Array.isArray((parsed as Record<string, unknown>).composeEnvEntries)
      ? ((parsed as Record<string, unknown>).composeEnvEntries as unknown[])
      : [];
  const frozenInputs =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parseFrozenComposeInputsPayload((parsed as Record<string, unknown>).frozenInputs)
      : undefined;

  if (!Array.isArray(encryptedEntries)) {
    return { envState: { kind: "queued", entries: [] }, frozenInputs };
  }

  const materializedEntries: ComposeEnvMaterializedEntry[] = [];
  const queuedEntries: ComposeEnvPayloadEntry[] = [];

  for (const entry of encryptedEntries) {
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
      envState: {
        kind: "materialized",
        entries: materializedEntries.sort((a, b) => a.key.localeCompare(b.key))
      },
      frozenInputs
    };
  }

  return {
    envState: {
      kind: "queued",
      entries: queuedEntries
    },
    frozenInputs
  };
}

export function readDeploymentComposeEnvState(
  envVarsEncrypted: string | null | undefined
): DeploymentComposeEnvState {
  return readDeploymentComposeState(envVarsEncrypted).envState;
}

export function readDeploymentComposeEnvEntries(
  envVarsEncrypted: string | null | undefined
): ComposeEnvPayloadEntry[] {
  const state = readDeploymentComposeState(envVarsEncrypted).envState;
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
  envEntries: ComposeEnvPayloadEntry[] | ComposeEnvMaterializedEntry[];
  composeEnv: ComposeEnvEvidence;
  composeInputs?: ComposeInputManifest;
  composeBuildPlan?: ComposeBuildPlan;
  frozenInputs?: FrozenComposeInputsPayload;
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
      envVarsEncrypted: encryptComposeDeploymentState({
        envEntries: input.envEntries,
        frozenInputs: input.frozenInputs
      }),
      configSnapshot: {
        ...snapshot,
        composeEnv: input.composeEnv,
        ...(input.composeBuildPlan ? { composeBuildPlan: input.composeBuildPlan } : {}),
        ...(input.composeInputs ? { composeInputs: input.composeInputs } : {})
      },
      updatedAt: new Date()
    })
    .where(eq(deployments.id, input.deploymentId));
}
