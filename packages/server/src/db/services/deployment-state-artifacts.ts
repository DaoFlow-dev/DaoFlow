import type { ComposeEnvEvidence } from "../../compose-env";
import {
  readComposeReadinessProbeSnapshot,
  type ComposeReadinessProbeSnapshot
} from "../../compose-readiness";
import { readComposePreviewMetadata, type ComposePreviewMetadata } from "../../compose-preview";
import {
  readServiceRuntimeConfig,
  renderServiceRuntimeOverrideComposePreview,
  type ServiceRuntimeConfig
} from "../../service-runtime-config";
import type { ConfigSnapshot, ComposeImageOverride } from "../../worker/step-management";
import { extractReplayableConfigSnapshot, readComposeImageOverride } from "./deployment-source";
import { normalizeStoredComposeDriftSnapshot } from "./compose-drift";
import {
  asRecord,
  readRecordArray,
  readString,
  readStringArray,
  type JsonRecord
} from "./json-helpers";

interface EnvironmentRow {
  config: unknown;
}

interface ServiceRow {
  name: string;
  sourceType: string;
  composeServiceName: string | null;
}

interface ServerRow {
  kind: string;
}

export interface DeploymentDeclaredStateArtifact {
  sourceType: string;
  deploymentSource: string | null;
  repoFullName: string | null;
  repoUrl: string | null;
  branch: string | null;
  composeServiceName: string | null;
  composeFiles: string[];
  composeProfiles: string[];
  stackName: string | null;
  targetServerName: string | null;
  targetServerHost: string | null;
  targetServerKind: string | null;
}

export interface DeploymentEffectiveStateArtifact {
  composeOperation: "up" | "down" | null;
  composeEnvBranch: string | null;
  readinessProbe: ComposeReadinessProbeSnapshot | null;
  imageOverride: ComposeImageOverride | null;
  runtimeConfig: ServiceRuntimeConfig | null;
  runtimeConfigPreview: string | null;
  preview: ComposePreviewMetadata | null;
  composeEnv: ComposeEnvEvidence | null;
  replayableSnapshot: ConfigSnapshot;
}

export interface DeploymentLiveRuntimeDiffArtifact {
  field: string;
  desiredValue: string;
  actualValue: string;
  impact: string;
}

export interface DeploymentLiveRuntimeArtifact {
  source: "cached-snapshot" | "unavailable";
  authoritative: false;
  attemptedAt: string | null;
  observedAt: string | null;
  maxAgeSeconds: number;
  evidenceRefs: string[];
  status: "drifted" | "blocked" | "unavailable";
  statusLabel: string;
  statusTone: "running" | "failed";
  summary: string;
  actualContainerState: string | null;
  desiredImageReference: string | null;
  actualImageReference: string | null;
  desiredReplicaCount: number | null;
  actualReplicaCount: number | null;
  impactSummary: string | null;
  recommendedActions: string[];
  diffs: DeploymentLiveRuntimeDiffArtifact[];
}

export interface DeploymentStateArtifacts {
  declaredConfig: DeploymentDeclaredStateArtifact;
  effectiveDeployment: DeploymentEffectiveStateArtifact;
  liveRuntime: DeploymentLiveRuntimeArtifact | null;
}

function readComposeEnvEvidence(snapshot: JsonRecord): ComposeEnvEvidence | null {
  const evidence = snapshot.composeEnv;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }

  return evidence as ComposeEnvEvidence;
}

function readDeclaredComposeFiles(snapshot: JsonRecord): string[] {
  const composeFiles = readStringArray(snapshot, "composeFilePaths");
  if (composeFiles.length > 0) {
    return composeFiles;
  }

  const singleComposeFile = readString(snapshot, "composeFilePath");
  return singleComposeFile ? [singleComposeFile] : [];
}

function readLiveRuntimeArtifact(input: {
  environment?: EnvironmentRow;
  deploymentServiceName: string;
  service?: ServiceRow;
}): DeploymentLiveRuntimeArtifact | null {
  const environmentConfig = asRecord(input.environment?.config);
  const reports = readRecordArray(environmentConfig, "composeDriftReports");
  const candidateNames = new Set(
    [input.service?.composeServiceName, input.service?.name, input.deploymentServiceName].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    )
  );

  const report = reports.find((entry) => candidateNames.has(readString(entry, "serviceName")));
  if (!report) {
    return null;
  }

  const snapshot = normalizeStoredComposeDriftSnapshot(report);

  return {
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
    actualContainerState: snapshot.actualContainerState,
    desiredImageReference: snapshot.desiredImageReference,
    actualImageReference: snapshot.actualImageReference,
    desiredReplicaCount: snapshot.desiredReplicaCount,
    actualReplicaCount: snapshot.actualReplicaCount,
    impactSummary: snapshot.impactSummary,
    recommendedActions: snapshot.recommendedActions,
    diffs: snapshot.diffs.map((diff) => ({
      field: diff.field,
      desiredValue: diff.desiredValue,
      actualValue: diff.actualValue,
      impact: diff.impact
    }))
  };
}

export function buildDeploymentStateArtifacts(input: {
  deployment: {
    sourceType: string;
    serviceName: string;
    configSnapshot: unknown;
  };
  environment?: EnvironmentRow;
  service?: ServiceRow;
  server?: ServerRow;
}): DeploymentStateArtifacts {
  const snapshot = asRecord(input.deployment.configSnapshot);
  const runtimeConfig = readServiceRuntimeConfig(snapshot.runtimeConfig);
  const composeServiceName =
    readString(snapshot, "composeServiceName") || input.service?.composeServiceName || null;

  return {
    declaredConfig: {
      sourceType: input.deployment.sourceType,
      deploymentSource: readString(snapshot, "deploymentSource") || null,
      repoFullName: readString(snapshot, "repoFullName") || null,
      repoUrl: readString(snapshot, "repoUrl") || null,
      branch: readString(snapshot, "branch") || null,
      composeServiceName,
      composeFiles: readDeclaredComposeFiles(snapshot),
      composeProfiles: readStringArray(snapshot, "composeProfiles"),
      stackName: readString(snapshot, "stackName") || null,
      targetServerName: readString(snapshot, "targetServerName") || null,
      targetServerHost: readString(snapshot, "targetServerHost") || null,
      targetServerKind: input.server?.kind ?? null
    },
    effectiveDeployment: {
      composeOperation:
        snapshot.composeOperation === "down"
          ? "down"
          : snapshot.composeOperation === "up"
            ? "up"
            : null,
      composeEnvBranch: readString(snapshot, "composeEnvBranch") || null,
      readinessProbe: readComposeReadinessProbeSnapshot(snapshot.readinessProbe),
      imageOverride: readComposeImageOverride(snapshot.composeImageOverride) ?? null,
      runtimeConfig,
      runtimeConfigPreview: renderServiceRuntimeOverrideComposePreview({
        composeServiceName,
        runtimeConfig
      }),
      preview: readComposePreviewMetadata(snapshot.preview),
      composeEnv: readComposeEnvEvidence(snapshot),
      replayableSnapshot: extractReplayableConfigSnapshot(snapshot)
    },
    liveRuntime: readLiveRuntimeArtifact({
      environment: input.environment,
      deploymentServiceName: input.deployment.serviceName,
      service: input.service
    })
  };
}
