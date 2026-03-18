import { basename, join } from "node:path";
import {
  createTarArchive,
  ensureStagingDir,
  extractTarArchive,
  getStagingArchivePath,
  gitClone,
  type OnLog
} from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { remoteEnsureDir, remoteExtractArchive, remoteGitClone, scpUpload } from "./ssh-executor";
import type { ConfigSnapshot } from "./step-management";
import { resolveCheckoutSpec } from "./checkout-source";

interface ComposeWorkspace {
  workDir: string;
  composeFile: string;
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

export async function prepareComposeWorkspace(
  deploymentId: string,
  config: ConfigSnapshot,
  target: ExecutionTarget,
  onLog: OnLog
): Promise<ComposeWorkspace> {
  if (!isUploadedCompose(config)) {
    const checkout = await resolveCheckoutSpec(config);
    if (!checkout) {
      throw new Error(
        "Compose deployment requires either uploaded artifacts or a repository source definition."
      );
    }

    if (target.mode === "remote") {
      if (checkout.requiresLocalMaterialization) {
        const localClone = await gitClone(checkout.repoUrl, checkout.branch, deploymentId, onLog, {
          displayLabel: checkout.displayLabel,
          gitConfig: checkout.gitConfig,
          repositoryPreparation: checkout.repositoryPreparation
        });
        if (localClone.exitCode !== 0) {
          throw new Error(
            localClone.errorMessage ?? `git clone failed with exit code ${localClone.exitCode}`
          );
        }

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

        const uploadArchive = await scpUpload(
          target.ssh,
          localArchivePath,
          remoteArchivePath,
          onLog
        );
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
          composeFile: config.composeFilePath ?? "docker-compose.yml"
        };
      }

      const result = await remoteGitClone(
        target.ssh,
        checkout.repoUrl,
        checkout.branch,
        target.remoteWorkDir,
        onLog,
        checkout.displayLabel
      );
      if (result.exitCode !== 0) {
        throw new Error(`git clone failed with exit code ${result.exitCode}`);
      }
      return {
        workDir: target.remoteWorkDir,
        composeFile: config.composeFilePath ?? "docker-compose.yml"
      };
    }

    const result = await gitClone(checkout.repoUrl, checkout.branch, deploymentId, onLog, {
      displayLabel: checkout.displayLabel,
      gitConfig: checkout.gitConfig,
      repositoryPreparation: checkout.repositoryPreparation
    });
    if (result.exitCode !== 0) {
      throw new Error(result.errorMessage ?? `git clone failed with exit code ${result.exitCode}`);
    }
    return {
      workDir: result.workDir,
      composeFile: config.composeFilePath ?? "docker-compose.yml"
    };
  }

  const localStageDir = ensureStagingDir(deploymentId);
  const composeFile = basename(resolveUploadedComposeFile(config));
  const contextArchive = resolveUploadedArchive(config);

  if (target.mode === "local") {
    if (contextArchive) {
      const extractResult = await extractTarArchive(
        join(localStageDir, contextArchive),
        localStageDir,
        onLog
      );
      if (extractResult.exitCode !== 0) {
        throw new Error(
          `Failed to extract uploaded context archive for deployment ${deploymentId}.`
        );
      }
    }

    return {
      workDir: localStageDir,
      composeFile
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

  const localComposePath = join(localStageDir, composeFile);
  const remoteComposePath = join(target.remoteWorkDir, composeFile);
  const uploadCompose = await scpUpload(target.ssh, localComposePath, remoteComposePath, onLog);
  if (uploadCompose.exitCode !== 0) {
    throw new Error(`Failed to upload compose file for deployment ${deploymentId}.`);
  }

  return {
    workDir: target.remoteWorkDir,
    composeFile
  };
}
