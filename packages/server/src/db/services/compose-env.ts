import { asc, eq } from "drizzle-orm";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { deployments } from "../schema/deployments";
import { environmentVariables } from "../schema/projects";
import { serviceVariables } from "../schema/services";
import {
  buildMaterializedComposeEnvEvidence,
  buildQueuedComposeEnvEvidence,
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
import { asRecord } from "./json-helpers";
import {
  normalizeStoredBranchPattern,
  readBranchPattern,
  resolveEffectiveEnvironmentVariableRecords,
  type LayeredEnvironmentVariableRecord
} from "./envvar-layering";

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

function parseFrozenComposeFilePayload(
  value: unknown
): FrozenComposeInputsPayload["composeFile"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.path !== "string" ||
    typeof record.sourcePath !== "string" ||
    typeof record.contents !== "string"
  ) {
    return null;
  }

  return {
    path: record.path,
    sourcePath: record.sourcePath,
    contents: record.contents
  };
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
  const composeFile =
    parseFrozenComposeFilePayload(record.composeFile) ??
    (Array.isArray(record.composeFiles)
      ? parseFrozenComposeFilePayload(record.composeFiles[0])
      : null);

  if (!composeFile) {
    return undefined;
  }

  return {
    composeFile,
    envFiles: parseFrozenEnvFilePayloads(record.envFiles)
  };
}

function normalizeFrozenInputsForSerialization(
  frozenInputs: FrozenComposeInputsPayload | undefined
): FrozenComposeInputsPayload | undefined {
  if (!frozenInputs) {
    return undefined;
  }

  return {
    composeFile: frozenInputs.composeFile,
    envFiles: frozenInputs.envFiles
  };
}

export async function resolveComposeDeploymentEnvEntries(input: {
  environmentId: string;
  serviceId?: string | null;
  branch: string;
  additionalEntries?: ComposeEnvPayloadEntry[];
}): Promise<ComposeEnvPayloadEntry[]> {
  const environmentRows = await db
    .select()
    .from(environmentVariables)
    .where(eq(environmentVariables.environmentId, input.environmentId))
    .orderBy(asc(environmentVariables.key));
  const serviceRows = input.serviceId
    ? await db
        .select()
        .from(serviceVariables)
        .where(eq(serviceVariables.serviceId, input.serviceId))
        .orderBy(asc(serviceVariables.key))
    : [];

  const layeredRecords = [
    ...environmentRows.map(
      (row) =>
        ({
          id: `envvar_${row.id}`,
          scope: "environment",
          environmentId: row.environmentId,
          environmentName: "",
          projectName: "",
          serviceId: null,
          serviceName: null,
          key: row.key,
          value: decrypt(row.valueEncrypted),
          isSecret: row.isSecret === "true",
          category: normalizeComposeEnvCategory(row.category),
          source: row.source === "1password" ? "1password" : "inline",
          secretRef: row.secretRef,
          branchPattern: normalizeStoredBranchPattern(row.branchPattern),
          updatedByEmail: "",
          updatedAt: row.updatedAt.toISOString()
        }) satisfies LayeredEnvironmentVariableRecord
    ),
    ...serviceRows.map(
      (row) =>
        ({
          id: `svcvar_${row.id}`,
          scope: "service",
          environmentId: input.environmentId,
          environmentName: "",
          projectName: "",
          serviceId: row.serviceId,
          serviceName: null,
          key: row.key,
          value: decrypt(row.valueEncrypted),
          isSecret: row.isSecret === "true",
          category: normalizeComposeEnvCategory(row.category),
          source: row.source === "1password" ? "1password" : "inline",
          secretRef: row.secretRef,
          branchPattern: normalizeStoredBranchPattern(row.branchPattern),
          updatedByEmail: "",
          updatedAt: row.updatedAt.toISOString()
        }) satisfies LayeredEnvironmentVariableRecord
    )
  ];

  const resolved: ComposeEnvPayloadEntry[] = resolveEffectiveEnvironmentVariableRecords({
    records: layeredRecords,
    branch: input.branch
  }).map((record) => ({
    key: record.key,
    value: record.value,
    category: record.category,
    isSecret: record.isSecret,
    source: record.source,
    branchPattern: readBranchPattern(record.branchPattern)
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
  serviceId?: string | null;
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
      ...(input.frozenInputs
        ? { frozenInputs: normalizeFrozenInputsForSerialization(input.frozenInputs) }
        : {})
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
  composeBuildPlan?: unknown;
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
