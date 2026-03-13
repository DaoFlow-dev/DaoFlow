import { desc } from "drizzle-orm";
import { db } from "../connection";
import { createDeploymentRecord } from "./deployments";
import { environments } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";

export interface ComposeDriftDiffRecord {
  id: string;
  field: string;
  desiredValue: string;
  actualValue: string;
  impact: string;
}

export interface ComposeDriftRecord {
  composeServiceId: string;
  environmentName: string;
  projectName: string;
  targetServerName: string;
  serviceName: string;
  composeFilePath: string;
  status: "aligned" | "drifted" | "blocked";
  summary: string;
  impactSummary: string;
  desiredImageReference: string;
  actualImageReference: string;
  desiredReplicaCount: number;
  actualReplicaCount: number;
  actualContainerState: string;
  lastCheckedAt: string;
  recommendedActions: string[];
  diffs: ComposeDriftDiffRecord[];
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readString(record: JsonRecord, key: string, fallback = "") {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function readNumber(record: JsonRecord, key: string, fallback = 0) {
  const value = record[key];
  return typeof value === "number" ? value : fallback;
}

function readStringArray(record: JsonRecord, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readRecordArray(record: JsonRecord, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

export async function listComposeReleaseCatalog(limit = 24) {
  const rows = await db.select().from(environments).orderBy(desc(environments.createdAt));
  const services = rows.flatMap((environment) => {
    const config = asRecord(environment.config);
    const composeServices = readRecordArray(config, "composeServices");

    return composeServices.map((service) => ({
      id: readString(service, "id"),
      environmentId: environment.id,
      environmentName: environment.name,
      projectName: readString(config, "projectName"),
      targetServerId: readString(config, "targetServerId"),
      targetServerName: readString(config, "targetServerName"),
      serviceName: readString(service, "serviceName"),
      composeFilePath: readString(config, "composeFilePath"),
      networkName: readString(config, "networkName"),
      imageReference: readString(service, "imageReference"),
      imageTag: readString(service, "imageReference"),
      replicaCount: readNumber(service, "replicaCount"),
      exposedPorts: readStringArray(service, "exposedPorts"),
      dependencies: readStringArray(service, "dependencies"),
      volumeMounts: readStringArray(service, "volumeMounts"),
      healthcheckPath: readString(service, "healthcheckPath") || null,
      releaseTrack: readString(service, "releaseTrack", "stable"),
      status: environment.status,
      createdAt: environment.createdAt.toISOString()
    }));
  });

  const sliced = services.slice(0, limit);
  const networks = new Set(sliced.map((service) => service.networkName).filter(Boolean));
  const healthyEnvironments = new Set(
    rows
      .filter((environment) => environment.status === "healthy")
      .map((environment) => environment.id)
  );

  return {
    summary: {
      totalServices: sliced.length,
      statefulServices: sliced.filter(
        (service) =>
          service.serviceName.includes("postgres") ||
          service.volumeMounts.some((mount) => mount.includes("/var/lib/postgresql/data"))
      ).length,
      healthyEnvironments: healthyEnvironments.size,
      uniqueNetworks: networks.size
    },
    services: sliced
  };
}

export async function listComposeDriftReport(limit = 24): Promise<{
  summary: {
    totalServices: number;
    alignedServices: number;
    driftedServices: number;
    blockedServices: number;
    reviewRequired: number;
  };
  reports: ComposeDriftRecord[];
}> {
  const rows = await db.select().from(environments).orderBy(desc(environments.createdAt));
  const reports = rows.flatMap((environment) => {
    const config = asRecord(environment.config);
    const driftReports = readRecordArray(config, "composeDriftReports");

    return driftReports.map((report) => ({
      composeServiceId: readString(report, "composeServiceId"),
      environmentName: environment.name,
      projectName: readString(config, "projectName"),
      targetServerName: readString(config, "targetServerName"),
      serviceName: readString(report, "serviceName"),
      composeFilePath: readString(config, "composeFilePath"),
      status: readString(report, "status", "aligned") as ComposeDriftRecord["status"],
      summary: readString(report, "summary"),
      impactSummary: readString(report, "impactSummary"),
      desiredImageReference: readString(report, "desiredImageReference"),
      actualImageReference: readString(report, "actualImageReference"),
      desiredReplicaCount: readNumber(report, "desiredReplicaCount"),
      actualReplicaCount: readNumber(report, "actualReplicaCount"),
      actualContainerState: readString(report, "actualContainerState"),
      lastCheckedAt: readString(report, "lastCheckedAt"),
      recommendedActions: readStringArray(report, "recommendedActions"),
      diffs: readRecordArray(report, "diffs").map((diff) => ({
        id: readString(diff, "id"),
        field: readString(diff, "field"),
        desiredValue: readString(diff, "desiredValue"),
        actualValue: readString(diff, "actualValue"),
        impact: readString(diff, "impact")
      }))
    }));
  });

  const sliced = reports.slice(0, limit);

  return {
    summary: {
      totalServices: sliced.length,
      alignedServices: sliced.filter((report) => report.status === "aligned").length,
      driftedServices: sliced.filter((report) => report.status === "drifted").length,
      blockedServices: sliced.filter((report) => report.status === "blocked").length,
      reviewRequired: sliced.filter((report) => report.status !== "aligned").length
    },
    reports: sliced
  };
}

export async function queueComposeRelease(input: {
  composeServiceId: string;
  commitSha: string;
  imageTag?: string | null;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: string;
}) {
  const catalog = await listComposeReleaseCatalog(100);
  const service = catalog.services.find((candidate) => candidate.id === input.composeServiceId);
  if (!service) return null;

  return createDeploymentRecord({
    projectName: service.projectName,
    environmentName: service.environmentName,
    serviceName: service.serviceName,
    sourceType: "compose",
    targetServerId: service.targetServerId,
    commitSha: input.commitSha,
    imageTag: input.imageTag ?? service.imageReference,
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole as AppRole,
    steps: [
      {
        label: "Resolve compose diff",
        detail: `Render the Compose delta for ${service.serviceName} in ${service.environmentName}.`
      },
      {
        label: "Queue execution handoff",
        detail: "Package the release for the SSH-backed docker-ssh worker queue."
      }
    ]
  });
}
