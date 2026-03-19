import { basename, dirname, join } from "node:path";
import {
  createTarArchive,
  ensureStagingDir,
  extractTarArchive,
  getStagingArchivePath,
  gitClone,
  type OnLog
} from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { remoteEnsureDir, remoteExtractArchive, scpUpload } from "./ssh-executor";
import type { ConfigSnapshot } from "./step-management";
import { resolveCheckoutSpec } from "./checkout-source";
import { restoreUploadedArtifacts } from "./uploaded-artifacts";
import {
  COMPOSE_ENV_EXPORT_FILE_NAME,
  COMPOSE_ENV_FILE_NAME,
  type ComposeEnvEvidence,
  type ComposeEnvMaterializedEntry
} from "../compose-env";
import type { ComposeBuildPlan } from "../compose-build-plan";
import type { ComposeInputManifest, FrozenComposeInputsPayload } from "../compose-inputs";
import { materializeComposeWorkspaceArtifacts } from "../compose-workspace-artifacts";
import type { DeploymentComposeState } from "../db/services/compose-env";

interface ComposeWorkspace {
  workDir: string;
  composeFile: string;
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

function resolveUploadedComposeFile(config: ConfigSnapshot): string {
  return config.uploadedComposeFileName ?? "compose.yaml";
}

function resolveUploadedArchive(config: ConfigSnapshot): string | null {
  return config.uploadedContextArchiveName ?? null;
}

function isUploadedCompose(config: ConfigSnapshot): boolean {
  return (
    config.deploymentSource === "uploaded-compose" || config.deploymentSource === "uploaded-context"
  );
}

function materializeComposeArtifacts(
  input: Parameters<typeof materializeComposeWorkspaceArtifacts>[0]
): Omit<ComposeWorkspace, "workDir"> {
  const artifacts = materializeComposeWorkspaceArtifacts(input);

  return {
    composeFile: artifacts.composeFile,
    composeBuildPlan: artifacts.composeBuildPlan,
    composeEnv: artifacts.composeEnv,
    composeInputs: artifacts.composeInputs
  };
}

async function uploadRemoteFiles(
  target: Extract<ExecutionTarget, { mode: "remote" }>,
  localWorkDir: string,
  remoteWorkDir: string,
  relativePaths: string[],
  onLog: OnLog,
  deploymentId: string
): Promise<void> {
  for (const relativePath of relativePaths) {
    const remoteDir = dirname(join(remoteWorkDir, relativePath));
    const ensureDir = await remoteEnsureDir(target.ssh, remoteDir, onLog);
    if (ensureDir.exitCode !== 0) {
      throw new Error(
        `Failed to prepare remote directory "${remoteDir}" for deployment ${deploymentId}.`
      );
    }

    const upload = await scpUpload(
      target.ssh,
      join(localWorkDir, relativePath),
      join(remoteWorkDir, relativePath),
      onLog
    );
    if (upload.exitCode !== 0) {
      throw new Error(
        `Failed to upload compose artifact "${relativePath}" for deployment ${deploymentId}.`
      );
    }
  }
}

export async function prepareComposeWorkspace(
  deploymentId: string,
  config: ConfigSnapshot,
  target: ExecutionTarget,
  onLog: OnLog,
  deploymentState: DeploymentComposeState = { envState: { kind: "queued", entries: [] } },
  pinnedCommitSha?: string
): Promise<ComposeWorkspace> {
  if (!isUploadedCompose(config)) {
    const checkout = await resolveCheckoutSpec(config);
    if (!checkout) {
      throw new Error(
        "Compose deployment requires either uploaded artifacts or a repository source definition."
      );
    }

    const localClone = await gitClone(checkout.repoUrl, checkout.branch, deploymentId, onLog, {
      displayLabel: checkout.displayLabel,
      gitConfig: checkout.gitConfig,
      repositoryPreparation: checkout.repositoryPreparation,
      commitSha: pinnedCommitSha
    });
    if (localClone.exitCode !== 0) {
      throw new Error(
        localClone.errorMessage ?? `git clone failed with exit code ${localClone.exitCode}`
      );
    }

    const artifacts = materializeComposeArtifacts({
      workDir: localClone.workDir,
      composeFile: config.composeFilePath ?? "docker-compose.yml",
      branch: config.composeEnvBranch ?? checkout.branch,
      sourceProvenance: "repository-checkout",
      deploymentState,
      imageOverride: config.composeImageOverride,
      existingComposeBuildPlan: config.composeBuildPlan,
      existingComposeEnv: config.composeEnv,
      existingComposeInputs: config.composeInputs
    });

    if (target.mode === "remote") {
      const remoteArchivePath = join(target.remoteWorkDir, `${deploymentId}.tar.gz`);
      const localArchivePath = getStagingArchivePath(deploymentId);
      const archiveResult = await createTarArchive(localClone.workDir, localArchivePath, onLog);
      if (archiveResult.exitCode !== 0) {
        throw new Error(`tar archive creation failed with exit code ${archiveResult.exitCode}`);
      }

      const ensureDirResult = await remoteEnsureDir(target.ssh, target.remoteWorkDir, onLog);
      if (ensureDirResult.exitCode !== 0) {
        throw new Error(`Failed to prepare remote workspace ${target.remoteWorkDir}.`);
      }

      const uploadArchive = await scpUpload(target.ssh, localArchivePath, remoteArchivePath, onLog);
      if (uploadArchive.exitCode !== 0) {
        throw new Error(`Failed to upload repository archive for deployment ${deploymentId}.`);
      }

      const extractRemote = await remoteExtractArchive(
        target.ssh,
        remoteArchivePath,
        target.remoteWorkDir,
        onLog
      );
      if (extractRemote.exitCode !== 0) {
        throw new Error(`Failed to extract repository archive for deployment ${deploymentId}.`);
      }

      return {
        workDir: target.remoteWorkDir,
        ...artifacts
      };
    }

    return {
      workDir: localClone.workDir,
      ...artifacts
    };
  }

  const localStageDir = ensureStagingDir(deploymentId);
  if (config.uploadedArtifactId) {
    await restoreUploadedArtifacts({
      artifactId: config.uploadedArtifactId,
      destinationDir: localStageDir,
      composeFileName: config.uploadedComposeFileName,
      contextArchiveName: config.uploadedContextArchiveName
    });
  }
  const composeFile = basename(resolveUploadedComposeFile(config));
  const contextArchive = resolveUploadedArchive(config);

  if (contextArchive) {
    const extractResult = await extractTarArchive(
      join(localStageDir, contextArchive),
      localStageDir,
      onLog
    );
    if (extractResult.exitCode !== 0) {
      throw new Error(
        target.mode === "local"
          ? `Failed to extract uploaded context archive for deployment ${deploymentId}.`
          : `Failed to extract uploaded context archive locally for deployment ${deploymentId}.`
      );
    }
  }

  const artifacts = materializeComposeArtifacts({
    workDir: localStageDir,
    composeFile,
    branch: config.composeEnvBranch ?? config.branch ?? "main",
    sourceProvenance: "uploaded-artifact",
    deploymentState,
    imageOverride: config.composeImageOverride,
    existingComposeBuildPlan: config.composeBuildPlan,
    existingComposeEnv: config.composeEnv,
    existingComposeInputs: config.composeInputs
  });

  if (target.mode === "local") {
    return {
      workDir: localStageDir,
      ...artifacts
    };
  }

  const ensureDirResult = await remoteEnsureDir(target.ssh, target.remoteWorkDir, onLog);
  if (ensureDirResult.exitCode !== 0) {
    throw new Error(`Failed to prepare remote workspace ${target.remoteWorkDir}.`);
  }

  if (contextArchive) {
    const localArchivePath = join(localStageDir, contextArchive);
    const remoteArchivePath = join(target.remoteWorkDir, contextArchive);
    const uploadArchive = await scpUpload(target.ssh, localArchivePath, remoteArchivePath, onLog);
    if (uploadArchive.exitCode !== 0) {
      throw new Error(`Failed to upload context archive for deployment ${deploymentId}.`);
    }

    const extractRemote = await remoteExtractArchive(
      target.ssh,
      remoteArchivePath,
      target.remoteWorkDir,
      onLog
    );
    if (extractRemote.exitCode !== 0) {
      throw new Error(`Failed to extract remote context archive for deployment ${deploymentId}.`);
    }
  }

  await uploadRemoteFiles(
    target,
    localStageDir,
    target.remoteWorkDir,
    [
      artifacts.composeFile,
      COMPOSE_ENV_FILE_NAME,
      COMPOSE_ENV_EXPORT_FILE_NAME,
      ...artifacts.composeInputs.frozenInputs.envFiles.map((envFile) => envFile.path)
    ],
    onLog,
    deploymentId
  );

  return {
    workDir: target.remoteWorkDir,
    ...artifacts
  };
}
