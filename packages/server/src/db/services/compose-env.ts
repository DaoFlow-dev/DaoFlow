import { asc, eq } from "drizzle-orm";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { deployments } from "../schema/deployments";
import { environmentVariables, environments, projects, projectVariables } from "../schema/projects";
import { serviceVariables } from "../schema/services";
import {
  buildMaterializedComposeEnvEvidence,
  buildQueuedComposeEnvEvidence,
  createComposeEnvContentRevision,
  type ComposeEnvEntryOrigin,
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
  getEnvironmentVariableOrigin,
  type LayeredEnvironmentVariableRecord
} from "./envvar-layering";
import {
  resolveTeamOnePasswordSecretReferences,
  type OnePasswordSecretReferenceResolver
} from "./onepassword";

function normalizeComposeEnvCategory(value: string): ComposeEnvVariableCategory {
  return value === "build" ? "build" : "runtime";
}

function readComposeEnvOrigin(value: unknown): ComposeEnvEntryOrigin {
  return value === "repo-default" ||
    value === "project" ||
    value === "environment" ||
    value === "service" ||
    value === "preview-environment" ||
    value === "preview-service" ||
    value === "preview-generated" ||
    value === "legacy-environment-variable"
    ? value
    : "legacy-environment-variable";
}

function readComposeEnvRevision(input: {
  value: unknown;
  origin: ComposeEnvEntryOrigin;
  key: string;
  entryValue: string;
  category: ComposeEnvVariableCategory | "default";
  source: "inline" | "1password" | "repo-default";
  branchPattern: string | null;
  isSecret: boolean;
}) {
  if (typeof input.value === "string" && input.value.length > 0) {
    return input.value;
  }

  if (input.origin === "repo-default") {
    return createComposeEnvContentRevision({
      origin: input.origin,
      key: input.key,
      value: input.entryValue
    });
  }

  const metadata = [
    input.origin,
    input.key,
    input.category,
    input.source,
    input.branchPattern ?? "",
    input.isSecret ? "secret" : "plain"
  ].join("\u0000");
  return createComposeEnvContentRevision({
    origin: "legacy-environment-variable",
    key: input.key,
    value: metadata
  }).replace("sha256:", "legacy:sha256:");
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

function parseFrozenManagedServiceLoggingOwnership(
  value: unknown
): FrozenComposeInputsPayload["managedServiceLoggingOwnership"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.serviceName !== "string" ||
    !record.serviceName.trim()
  ) {
    return undefined;
  }
  return { version: 1, serviceName: record.serviceName };
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

  const managedServiceLoggingOwnership = parseFrozenManagedServiceLoggingOwnership(
    record.managedServiceLoggingOwnership
  );

  return {
    composeFile,
    envFiles: parseFrozenEnvFilePayloads(record.envFiles),
    ...(managedServiceLoggingOwnership ? { managedServiceLoggingOwnership } : {})
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
    envFiles: frozenInputs.envFiles,
    ...(frozenInputs.managedServiceLoggingOwnership
      ? { managedServiceLoggingOwnership: frozenInputs.managedServiceLoggingOwnership }
      : {})
  };
}

export async function resolveComposeDeploymentEnvEntries(input: {
  environmentId: string;
  serviceId?: string | null;
  branch: string;
  additionalEntries?: ComposeEnvPayloadEntry[];
  resolveOnePasswordSecretReference?: OnePasswordSecretReferenceResolver;
}): Promise<ComposeEnvPayloadEntry[]> {
  const [environment] = await db
    .select({ id: environments.id, projectId: environments.projectId, teamId: projects.teamId })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(environments.id, input.environmentId))
    .limit(1);
  const projectRows = environment
    ? await db
        .select()
        .from(projectVariables)
        .where(eq(projectVariables.projectId, environment.projectId))
        .orderBy(asc(projectVariables.key))
    : [];
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
    ...projectRows.map(
      (row) =>
        ({
          id: `projvar_${row.id}`,
          scope: "project",
          projectId: row.projectId,
          projectName: "",
          environmentId: null,
          environmentName: null,
          serviceId: null,
          serviceName: null,
          key: row.key,
          value: decrypt(row.valueEncrypted),
          isSecret: row.isSecret === "true" || row.source === "1password",
          category: normalizeComposeEnvCategory(row.category),
          source: row.source === "1password" ? "1password" : "inline",
          secretRef: row.secretRef,
          branchPattern: "",
          revision: row.revision,
          updatedByEmail: "",
          updatedAt: row.updatedAt.toISOString()
        }) satisfies LayeredEnvironmentVariableRecord
    ),
    ...environmentRows.map(
      (row) =>
        ({
          id: `envvar_${row.id}`,
          scope: "environment",
          projectId: environment?.projectId ?? "",
          environmentId: row.environmentId,
          environmentName: "",
          projectName: "",
          serviceId: null,
          serviceName: null,
          key: row.key,
          value: decrypt(row.valueEncrypted),
          isSecret: row.isSecret === "true" || row.source === "1password",
          category: normalizeComposeEnvCategory(row.category),
          source: row.source === "1password" ? "1password" : "inline",
          secretRef: row.secretRef,
          branchPattern: normalizeStoredBranchPattern(row.branchPattern),
          revision: row.revision,
          updatedByEmail: "",
          updatedAt: row.updatedAt.toISOString()
        }) satisfies LayeredEnvironmentVariableRecord
    ),
    ...serviceRows.map(
      (row) =>
        ({
          id: `svcvar_${row.id}`,
          scope: "service",
          projectId: environment?.projectId ?? "",
          environmentId: input.environmentId,
          environmentName: "",
          projectName: "",
          serviceId: row.serviceId,
          serviceName: null,
          key: row.key,
          value: decrypt(row.valueEncrypted),
          isSecret: row.isSecret === "true" || row.source === "1password",
          category: normalizeComposeEnvCategory(row.category),
          source: row.source === "1password" ? "1password" : "inline",
          secretRef: row.secretRef,
          branchPattern: normalizeStoredBranchPattern(row.branchPattern),
          revision: row.revision,
          updatedByEmail: "",
          updatedAt: row.updatedAt.toISOString()
        }) satisfies LayeredEnvironmentVariableRecord
    )
  ];

  const resolvedRecords = resolveEffectiveEnvironmentVariableRecords({
    records: layeredRecords,
    branch: input.branch
  });
  const onePasswordReferences = resolvedRecords
    .filter((record) => record.source === "1password")
    .map((record) => {
      if (!record.secretRef) {
        throw new Error(
          `1Password environment variable ${record.key} is missing a secret reference.`
        );
      }

      return { id: record.id, secretRef: record.secretRef };
    });
  if (onePasswordReferences.length > 0 && !environment) {
    throw new Error("Environment variable target not found.");
  }
  const resolvedOnePasswordValues = await resolveTeamOnePasswordSecretReferences({
    teamId: environment?.teamId ?? "",
    references: onePasswordReferences,
    resolveReference: input.resolveOnePasswordSecretReference
  });
  const resolved: ComposeEnvPayloadEntry[] = resolvedRecords.map((record) => {
    const value =
      record.source === "1password" ? resolvedOnePasswordValues.get(record.id) : record.value;
    if (value === undefined) {
      throw new Error(`1Password environment variable ${record.key} could not be resolved.`);
    }

    return {
      key: record.key,
      value,
      category: record.category,
      isSecret: record.isSecret || record.source === "1password",
      source: record.source,
      branchPattern: readBranchPattern(record.branchPattern),
      origin: getEnvironmentVariableOrigin(record),
      revision: String(record.revision)
    };
  });

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
  resolveOnePasswordSecretReference?: OnePasswordSecretReferenceResolver;
}): Promise<{
  envVarsEncrypted: string;
  composeEnv: ComposeEnvEvidence;
}> {
  const entries = await resolveComposeDeploymentEnvEntries(input);

  return {
    envVarsEncrypted: encryptComposeDeploymentState({ envEntries: entries }),
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
    const origin = readComposeEnvOrigin(record.origin);

    if (!key || value === null) {
      continue;
    }

    const category =
      record.category === "build" || record.category === "runtime"
        ? record.category
        : record.category === "default"
          ? "default"
          : "runtime";
    const source =
      record.source === "1password"
        ? "1password"
        : record.source === "repo-default"
          ? "repo-default"
          : "inline";
    const revision = readComposeEnvRevision({
      value: record.revision,
      origin,
      key,
      entryValue: value,
      category,
      source,
      branchPattern,
      isSecret
    });

    if (
      record.category === "default" ||
      record.source === "repo-default" ||
      typeof record.overrodeRepoDefault === "boolean"
    ) {
      materializedEntries.push({
        key,
        value,
        category,
        isSecret,
        source,
        branchPattern,
        origin: record.origin === "repo-default" ? "repo-default" : origin,
        revision,
        overrodeRepoDefault: record.overrodeRepoDefault === true
      });
      continue;
    }

    queuedEntries.push({
      key,
      value,
      category: normalizeComposeEnvCategory(category),
      isSecret,
      source: source === "1password" ? "1password" : "inline",
      branchPattern,
      origin,
      revision
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
    branchPattern: entry.branchPattern,
    origin: entry.origin,
    revision: entry.revision
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
