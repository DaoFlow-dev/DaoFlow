import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { createDeploymentRecord } from "./deployments";
import { dispatchDeploymentExecution } from "./deployment-dispatch";
import { environments, projects } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";
import { asRecord, readString, readNumber, readStringArray, readRecordArray } from "./json-helpers";
import { buildComposeSourceSnapshot } from "./deployment-source";

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
  statusLabel: string;
  statusTone: "healthy" | "running" | "failed";
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

function formatReleaseTrackLabel(releaseTrack: string) {
  if (!releaseTrack) {
    return "Stable";
  }

  return `${releaseTrack.slice(0, 1).toUpperCase()}${releaseTrack.slice(1)}`;
}

function getReleaseTrackTone(releaseTrack: string) {
  return releaseTrack === "stable" ? "healthy" : "running";
}

function formatComposeDriftStatusLabel(status: ComposeDriftRecord["status"]) {
  if (status === "aligned") {
    return "Aligned";
  }

  if (status === "blocked") {
    return "Blocked";
  }

  return "Review required";
}

function getComposeDriftStatusTone(status: ComposeDriftRecord["status"]) {
  if (status === "aligned") {
    return "healthy" as const;
  }

  if (status === "blocked") {
    return "failed" as const;
  }

  return "running" as const;
}

export async function listComposeReleaseCatalog(limit = 24) {
  const rows = await db.select().from(environments).orderBy(desc(environments.createdAt));
  const services = rows.flatMap((environment) => {
    const config = asRecord(environment.config);
    const composeServices = readRecordArray(config, "composeServices");

    return composeServices.map((service) => {
      const releaseTrack = readString(service, "releaseTrack", "stable");

      return {
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
        replicaCount: readNumber(service, "replicaCount", 0) ?? 0,
        exposedPorts: readStringArray(service, "exposedPorts"),
        dependencies: readStringArray(service, "dependencies"),
        volumeMounts: readStringArray(service, "volumeMounts"),
        healthcheckPath: readString(service, "healthcheckPath") || null,
        releaseTrack,
        releaseTrackTone: getReleaseTrackTone(releaseTrack),
        releaseTrackLabel: formatReleaseTrackLabel(releaseTrack),
        status: environment.status,
        createdAt: environment.createdAt.toISOString()
      };
    });
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

    return driftReports.map((report) => {
      const status = readString(report, "status", "aligned") as ComposeDriftRecord["status"];

      return {
        composeServiceId: readString(report, "composeServiceId"),
        environmentName: environment.name,
        projectName: readString(config, "projectName"),
        targetServerName: readString(config, "targetServerName"),
        serviceName: readString(report, "serviceName"),
        composeFilePath: readString(config, "composeFilePath"),
        status,
        statusLabel: formatComposeDriftStatusLabel(status),
        statusTone: getComposeDriftStatusTone(status),
        summary: readString(report, "summary"),
        impactSummary: readString(report, "impactSummary"),
        desiredImageReference: readString(report, "desiredImageReference"),
        actualImageReference: readString(report, "actualImageReference"),
        desiredReplicaCount: readNumber(report, "desiredReplicaCount", 0) ?? 0,
        actualReplicaCount: readNumber(report, "actualReplicaCount", 0) ?? 0,
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
      };
    });
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

  const [environment] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, service.environmentId))
    .limit(1);
  if (!environment) return null;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, environment.projectId))
    .limit(1);
  if (!project) return null;

  const deployment = await createDeploymentRecord({
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
    configSnapshot: buildComposeSourceSnapshot({
      project: {
        ...project,
        composePath: service.composeFilePath || project.composePath
      },
      environment,
      composeServiceName: service.serviceName
    }),
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

  if (!deployment) {
    return null;
  }

  await dispatchDeploymentExecution(deployment);
  return deployment;
}
