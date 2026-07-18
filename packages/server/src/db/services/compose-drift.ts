import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";
import {
  asRecord,
  readNumber,
  readRecordArray,
  readString,
  readStringArray,
  type JsonRecord
} from "./json-helpers";

const DEFAULT_CACHED_SNAPSHOT_MAX_AGE_SECONDS = 900;

export type ComposeDriftSource = "cached-snapshot" | "unavailable";
export type ComposeDriftStatus = "drifted" | "blocked" | "unavailable";

export interface ComposeDriftDiffRecord {
  id: string;
  field: string;
  desiredValue: string;
  actualValue: string;
  impact: string;
}

export interface ComposeDriftTarget {
  serverId: string | null;
  serverName: string | null;
  composeProjectName: string | null;
}

export interface ComposeDriftRecord {
  composeServiceId: string;
  environmentId: string;
  environmentName: string;
  projectId: string;
  projectName: string;
  serviceName: string;
  composeFilePath: string | null;
  target: ComposeDriftTarget;
  source: ComposeDriftSource;
  authoritative: false;
  attemptedAt: string | null;
  observedAt: string | null;
  maxAgeSeconds: number;
  evidenceRefs: string[];
  status: ComposeDriftStatus;
  statusLabel: string;
  statusTone: "running" | "failed";
  summary: string;
  impactSummary: string | null;
  desiredImageReference: string | null;
  actualImageReference: string | null;
  desiredReplicaCount: number | null;
  actualReplicaCount: number | null;
  actualContainerState: string | null;
  recommendedActions: string[];
  diffs: ComposeDriftDiffRecord[];
}

/**
 * This is deliberately a type-only boundary. It documents the narrow, safe
 * request that a later live collector may implement once #230 and #233 exist.
 * Nothing in the containment phase invokes Docker, SSH, or this interface.
 */
export interface ComposeDriftLiveInspectionRequest {
  teamId: string;
  projectId: string;
  environmentId: string;
  target: {
    serverId: string;
    serverName: string;
    composeProjectName: string;
  };
  ownedResourceLabels: {
    "io.daoflow.managed": "true";
    "io.daoflow.team-id": string;
    "io.daoflow.project-id": string;
    "io.daoflow.environment-id": string;
  };
  limits: {
    minimumIntervalSeconds: number;
    maxConcurrentPerServer: number;
  };
}

export interface ComposeDriftLiveInspectionResult {
  target: ComposeDriftTarget;
  attemptedAt: string;
  observedAt: string | null;
  outcome: "observed" | "unavailable";
  evidenceRefs: string[];
  diffs: ComposeDriftDiffRecord[];
}

export interface ComposeDriftLiveInspectionAdapter {
  inspect(request: ComposeDriftLiveInspectionRequest): Promise<ComposeDriftLiveInspectionResult>;
}

export const composeDriftLiveInspectionContract = {
  availability: "not-implemented" as const,
  blockers: ["#230 strict SSH host identity", "#233 DaoFlow-owned resource selection"],
  limits: {
    minimumIntervalSeconds: 60,
    maxConcurrentPerServer: 1
  },
  collection: {
    composePsFormat: "json" as const,
    inspectFields: [
      "Id",
      "Image",
      "State.Status",
      "State.Health.Status",
      "NetworkSettings.Ports",
      "Mounts",
      "HostConfig.NanoCpus",
      "HostConfig.Memory",
      "Config.Labels"
    ]
  },
  persistence: {
    allowed: ["normalized-diff", "safe-evidence-id", "timestamps"],
    forbidden: ["raw-docker-inspect-output", "environment-values", "credentials"]
  }
};

interface StoredComposeDriftSnapshot {
  source: ComposeDriftSource;
  authoritative: false;
  attemptedAt: string | null;
  observedAt: string | null;
  maxAgeSeconds: number;
  evidenceRefs: string[];
  status: ComposeDriftStatus;
  statusLabel: string;
  statusTone: "running" | "failed";
  summary: string;
  impactSummary: string | null;
  desiredImageReference: string | null;
  actualImageReference: string | null;
  desiredReplicaCount: number | null;
  actualReplicaCount: number | null;
  actualContainerState: string | null;
  recommendedActions: string[];
  diffs: ComposeDriftDiffRecord[];
}

function readIsoTimestamp(record: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    const raw = readString(record, key).trim();
    if (!raw) continue;

    const timestamp = new Date(raw);
    if (!Number.isNaN(timestamp.getTime())) {
      return timestamp.toISOString();
    }
  }

  return null;
}

function readMaxAgeSeconds(record: JsonRecord) {
  const value = readNumber(record, "maxAgeSeconds");
  return value && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_CACHED_SNAPSHOT_MAX_AGE_SECONDS;
}

function readEvidenceRefs(record: JsonRecord) {
  return [...new Set(readStringArray(record, "evidenceRefs"))]
    .filter((value) => /^[A-Za-z0-9:_-]{1,120}$/.test(value))
    .slice(0, 20);
}

function getContainedStatus(storedStatus: string): ComposeDriftStatus {
  if (storedStatus === "drifted") return "drifted";
  if (storedStatus === "blocked") return "blocked";

  // Legacy "aligned" values were never backed by a host inspection. Do not
  // let a stored configuration value present as current runtime alignment.
  return "unavailable";
}

function getStatusLabel(status: ComposeDriftStatus, source: ComposeDriftSource) {
  if (status === "drifted") return "Cached drift snapshot";
  if (status === "blocked") return "Cached blocked snapshot";
  return source === "cached-snapshot"
    ? "Cached snapshot cannot confirm alignment"
    : "Live inspection unavailable";
}

function getStatusTone(status: ComposeDriftStatus) {
  return status === "blocked" ? ("failed" as const) : ("running" as const);
}

function readDiffs(record: JsonRecord) {
  return readRecordArray(record, "diffs").map((diff, index) => ({
    id: readString(diff, "id") || `cached-diff-${index + 1}`,
    field: readString(diff, "field"),
    desiredValue: readString(diff, "desiredValue"),
    actualValue: readString(diff, "actualValue"),
    impact: readString(diff, "impact")
  }));
}

export function normalizeStoredComposeDriftSnapshot(
  record: JsonRecord | undefined
): StoredComposeDriftSnapshot {
  if (!record) {
    return {
      source: "unavailable",
      authoritative: false,
      attemptedAt: null,
      observedAt: null,
      maxAgeSeconds: DEFAULT_CACHED_SNAPSHOT_MAX_AGE_SECONDS,
      evidenceRefs: [],
      status: "unavailable",
      statusLabel: "Live inspection unavailable",
      statusTone: "running",
      summary:
        "No stored drift snapshot is available. DaoFlow has not inspected this host in the containment phase.",
      impactSummary: null,
      desiredImageReference: null,
      actualImageReference: null,
      desiredReplicaCount: null,
      actualReplicaCount: null,
      actualContainerState: null,
      recommendedActions: [
        "Do not treat this service as aligned until the bounded live inspection phase is available."
      ],
      diffs: []
    };
  }

  const status = getContainedStatus(readString(record, "status"));
  const source = "cached-snapshot" as const;
  const snapshotSummary = readString(record, "summary").trim();

  return {
    source,
    authoritative: false,
    attemptedAt: readIsoTimestamp(record, "attemptedAt", "lastCheckedAt"),
    observedAt: readIsoTimestamp(record, "observedAt", "lastCheckedAt"),
    maxAgeSeconds: readMaxAgeSeconds(record),
    evidenceRefs: readEvidenceRefs(record),
    status,
    statusLabel: getStatusLabel(status, source),
    statusTone: getStatusTone(status),
    summary:
      status === "unavailable"
        ? "A cached snapshot exists, but it cannot verify current runtime alignment."
        : snapshotSummary
          ? `Cached snapshot only: ${snapshotSummary}`
          : "Cached drift data is available, but no live inspection has verified it.",
    impactSummary: readString(record, "impactSummary") || null,
    desiredImageReference: readString(record, "desiredImageReference") || null,
    actualImageReference: readString(record, "actualImageReference") || null,
    desiredReplicaCount: readNumber(record, "desiredReplicaCount"),
    actualReplicaCount: readNumber(record, "actualReplicaCount"),
    actualContainerState: readString(record, "actualContainerState") || null,
    recommendedActions: [
      "Treat this as a non-authoritative cached snapshot, not a live host inspection.",
      ...readStringArray(record, "recommendedActions")
    ],
    diffs: readDiffs(record)
  };
}

function findStoredSnapshot(input: { reports: JsonRecord[]; service: JsonRecord }) {
  const serviceId = readString(input.service, "id");
  const serviceName = readString(input.service, "serviceName");

  return input.reports.find(
    (report) =>
      (serviceId && readString(report, "composeServiceId") === serviceId) ||
      (serviceName && readString(report, "serviceName") === serviceName)
  );
}

function buildRecord(input: {
  environment: typeof environments.$inferSelect;
  project: typeof projects.$inferSelect;
  config: JsonRecord;
  snapshotRecord?: JsonRecord;
  service?: JsonRecord;
  fallbackIndex: number;
}): ComposeDriftRecord {
  const snapshot = normalizeStoredComposeDriftSnapshot(input.snapshotRecord);
  const service = input.service ?? {};
  const composeServiceId =
    readString(service, "id") ||
    readString(input.snapshotRecord ?? {}, "composeServiceId") ||
    `cached-snapshot-${input.environment.id}-${input.fallbackIndex}`;
  const serviceName =
    readString(service, "serviceName") ||
    readString(input.snapshotRecord ?? {}, "serviceName") ||
    "Unknown Compose service";
  const target = {
    serverId: readString(input.config, "targetServerId") || null,
    serverName: readString(input.config, "targetServerName") || null,
    composeProjectName:
      readString(input.config, "composeProjectName") ||
      readString(input.config, "projectName") ||
      null
  };

  return {
    composeServiceId,
    environmentId: input.environment.id,
    environmentName: input.environment.name,
    projectId: input.project.id,
    projectName: input.project.name,
    serviceName,
    composeFilePath: readString(input.config, "composeFilePath") || null,
    target,
    source: snapshot.source,
    authoritative: false,
    attemptedAt: snapshot.attemptedAt,
    observedAt: snapshot.observedAt,
    maxAgeSeconds: snapshot.maxAgeSeconds,
    evidenceRefs: snapshot.evidenceRefs,
    status: snapshot.status,
    statusLabel: snapshot.statusLabel,
    statusTone: snapshot.statusTone,
    summary: snapshot.summary,
    impactSummary: snapshot.impactSummary,
    desiredImageReference: readString(service, "imageReference") || snapshot.desiredImageReference,
    actualImageReference: snapshot.actualImageReference,
    desiredReplicaCount: readNumber(service, "replicaCount") ?? snapshot.desiredReplicaCount,
    actualReplicaCount: snapshot.actualReplicaCount,
    actualContainerState: snapshot.actualContainerState,
    recommendedActions: snapshot.recommendedActions,
    diffs: snapshot.diffs
  };
}

export async function listComposeDriftReport(input: { teamId: string; limit: number }) {
  const rows = await db
    .select({ environment: environments, project: projects })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(projects.teamId, input.teamId))
    .orderBy(desc(environments.createdAt));

  const reports = rows.flatMap(({ environment, project }) => {
    const config = asRecord(environment.config);
    const composeServices = readRecordArray(config, "composeServices");
    const snapshots = readRecordArray(config, "composeDriftReports");
    const matchedSnapshots = new Set<JsonRecord>();
    const serviceReports = composeServices.map((service, index) => {
      const snapshot = findStoredSnapshot({ reports: snapshots, service });
      if (snapshot) matchedSnapshots.add(snapshot);

      return buildRecord({
        environment,
        project,
        config,
        service,
        snapshotRecord: snapshot,
        fallbackIndex: index + 1
      });
    });

    const unmatchedSnapshots = snapshots
      .filter((snapshot) => !matchedSnapshots.has(snapshot))
      .map((snapshot, index) =>
        buildRecord({
          environment,
          project,
          config,
          snapshotRecord: snapshot,
          fallbackIndex: composeServices.length + index + 1
        })
      );

    return [...serviceReports, ...unmatchedSnapshots];
  });

  const sliced = reports.slice(0, input.limit);

  return {
    inspection: composeDriftLiveInspectionContract,
    summary: {
      totalServices: sliced.length,
      cachedSnapshotServices: sliced.filter((report) => report.source === "cached-snapshot").length,
      unavailableServices: sliced.filter((report) => report.source === "unavailable").length,
      driftedServices: sliced.filter((report) => report.status === "drifted").length,
      blockedServices: sliced.filter((report) => report.status === "blocked").length,
      reviewRequired: sliced.length
    },
    reports: sliced
  };
}
