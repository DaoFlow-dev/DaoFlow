import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import {
  buildComposeEnvArtifact,
  buildMaterializedComposeEnvEvidence,
  COMPOSE_ENV_FILE_NAME,
  renderComposeEnvFile,
  type ComposeEnvEvidence,
  type ComposeEnvMaterializedEntry
} from "./compose-env";
import {
  materializeComposeInputs,
  type ComposeImageOverrideRequest,
  type ComposeInputManifest,
  type FrozenComposeInputsPayload
} from "./compose-inputs";
import type { DeploymentComposeEnvState, DeploymentComposeState } from "./db/services/compose-env";

export interface MaterializedComposeWorkspaceArtifacts {
  composeFile: string;
  repoDefaultContent: string | null;
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

  return {
    composeEnv: artifact.composeEnv,
    payloadEntries: artifact.payloadEntries,
    fileContents: artifact.envFileContents
  };
}

export function materializeComposeWorkspaceArtifacts(input: {
  workDir: string;
  composeFile: string;
  branch: string;
  sourceProvenance: "repository-checkout" | "uploaded-artifact";
  deploymentState: DeploymentComposeState;
  imageOverride?: ComposeImageOverrideRequest;
  existingComposeEnv?: ComposeEnvEvidence;
  existingComposeInputs?: ComposeInputManifest;
}): MaterializedComposeWorkspaceArtifacts {
  const repoDefaultContent = readRepoDefaultEnvFile(input.workDir, input.composeFile);
  const composeEnv = materializeComposeEnv({
    workDir: input.workDir,
    composeFile: input.composeFile,
    branch: input.branch,
    deploymentEnvState: input.deploymentState.envState,
    existingEvidence: input.existingComposeEnv
  });
  const composeInputs = materializeComposeInputs({
    workDir: input.workDir,
    composeFile: input.composeFile,
    sourceProvenance: input.sourceProvenance,
    repoDefaultContent,
    composeEnvFileContents: composeEnv.fileContents,
    imageOverride: input.imageOverride,
    existingManifest: input.existingComposeInputs,
    existingFrozenInputs: input.deploymentState.frozenInputs
  });

  return {
    composeFile: composeInputs.composeFile,
    repoDefaultContent,
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
