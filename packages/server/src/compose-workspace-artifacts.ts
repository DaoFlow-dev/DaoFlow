import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import {
  buildComposeEnvArtifact,
  buildMaterializedComposeEnvEvidence,
  COMPOSE_ENV_FILE_NAME,
  COMPOSE_ENV_EXPORT_FILE_NAME,
  renderComposeEnvExportFile,
  renderComposeEnvFile,
  type ComposeEnvEvidence,
  type ComposeEnvMaterializedEntry
} from "./compose-env";
import type { ComposeBuildPlan } from "./compose-build-plan";
import {
  materializeComposeInputs,
  type ComposeImageOverrideRequest,
  type ComposeInputManifest,
  type FrozenComposeInputsPayload
} from "./compose-inputs";
import type { ServiceRuntimeConfig } from "./service-runtime-config";
import type { DeploymentComposeEnvState, DeploymentComposeState } from "./db/services/compose-env";

export interface MaterializedComposeWorkspaceArtifacts {
  composeFiles: string[];
  repoDefaultContent: string | null;
  composeBuildPlan: ComposeBuildPlan;
  composeEnv: {
    composeEnv: ComposeEnvEvidence;
    payloadEntries: ComposeEnvMaterializedEntry[];
  };
  composeInputs: {
    manifest: ComposeInputManifest;
    frozenInputs: FrozenComposeInputsPayload;
  };
}

function readRepoDefaultEnvFile(workDir: string, composeFile: string): string | null {
  const composeDir = dirname(composeFile);
  const envPath = isAbsolute(composeDir)
    ? join(composeDir, ".env")
    : join(workDir, composeDir, ".env");
  return existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
}

function materializeComposeEnv(input: {
  workDir: string;
  composeFile: string;
  branch: string;
  deploymentEnvState: DeploymentComposeEnvState;
  existingEvidence?: ComposeEnvEvidence;
}): {
  composeEnv: ComposeEnvEvidence;
  payloadEntries: ComposeEnvMaterializedEntry[];
  fileContents: string;
} {
  if (input.deploymentEnvState.kind === "materialized") {
    const fileContents = renderComposeEnvFile(input.deploymentEnvState.entries);
    writeFileSync(join(input.workDir, COMPOSE_ENV_FILE_NAME), fileContents, {
      mode: 0o600
    });
    writeFileSync(
      join(input.workDir, COMPOSE_ENV_EXPORT_FILE_NAME),
      renderComposeEnvExportFile(input.deploymentEnvState.entries),
      { mode: 0o600 }
    );

    return {
      composeEnv:
        input.existingEvidence?.status === "materialized"
          ? input.existingEvidence
          : buildMaterializedComposeEnvEvidence(input.branch, input.deploymentEnvState.entries),
      payloadEntries: input.deploymentEnvState.entries,
      fileContents
    };
  }

  const artifact = buildComposeEnvArtifact({
    branch: input.branch,
    repoDefaultContent: readRepoDefaultEnvFile(input.workDir, input.composeFile),
    deploymentEntries: input.deploymentEnvState.entries
  });

  writeFileSync(join(input.workDir, COMPOSE_ENV_FILE_NAME), artifact.envFileContents, {
    mode: 0o600
  });
  writeFileSync(
    join(input.workDir, COMPOSE_ENV_EXPORT_FILE_NAME),
    renderComposeEnvExportFile(artifact.payloadEntries),
    { mode: 0o600 }
  );

  return {
    composeEnv: artifact.composeEnv,
    payloadEntries: artifact.payloadEntries,
    fileContents: artifact.envFileContents
  };
}

export function materializeComposeWorkspaceArtifacts(input: {
  workDir: string;
  composeFiles: string[];
  composeProfiles?: string[];
  branch: string;
  sourceProvenance: "repository-checkout" | "uploaded-artifact";
  deploymentState: DeploymentComposeState;
  imageOverride?: ComposeImageOverrideRequest;
  runtimeConfig?: ServiceRuntimeConfig | null;
  composeServiceName?: string | null;
  existingComposeBuildPlan?: ComposeBuildPlan;
  existingComposeEnv?: ComposeEnvEvidence;
  existingComposeInputs?: ComposeInputManifest;
}): MaterializedComposeWorkspaceArtifacts {
  const primaryComposeFile = input.composeFiles[0] ?? "docker-compose.yml";
  const repoDefaultContent = readRepoDefaultEnvFile(input.workDir, primaryComposeFile);
  const composeEnv = materializeComposeEnv({
    workDir: input.workDir,
    composeFile: primaryComposeFile,
    branch: input.branch,
    deploymentEnvState: input.deploymentState.envState,
    existingEvidence: input.existingComposeEnv
  });
  const composeInputs = materializeComposeInputs({
    workDir: input.workDir,
    composeFiles: input.composeFiles,
    composeProfiles: input.composeProfiles,
    sourceProvenance: input.sourceProvenance,
    repoDefaultContent,
    composeEnvFileContents: composeEnv.fileContents,
    imageOverride: input.imageOverride,
    runtimeConfig: input.runtimeConfig,
    composeServiceName: input.composeServiceName,
    existingBuildPlan: input.existingComposeBuildPlan,
    existingManifest: input.existingComposeInputs,
    existingFrozenInputs: input.deploymentState.frozenInputs
  });

  return {
    composeFiles: composeInputs.composeFiles,
    repoDefaultContent,
    composeBuildPlan: composeInputs.buildPlan,
    composeEnv: {
      composeEnv: composeEnv.composeEnv,
      payloadEntries: composeEnv.payloadEntries
    },
    composeInputs: {
      manifest: composeInputs.manifest,
      frozenInputs: composeInputs.frozenInputs
    }
  };
}
