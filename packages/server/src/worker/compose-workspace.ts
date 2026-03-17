import { basename, join } from "node:path";
import { ensureStagingDir, extractTarArchive, gitClone, type OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { remoteEnsureDir, remoteExtractArchive, remoteGitClone, scpUpload } from "./ssh-executor";
import type { ConfigSnapshot } from "./step-management";

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
  branch: string,
  repoUrl: string,
  target: ExecutionTarget,
  onLog: OnLog
): Promise<ComposeWorkspace> {
  if (!isUploadedCompose(config)) {
    if (target.mode === "remote") {
      const result = await remoteGitClone(target.ssh, repoUrl, branch, target.remoteWorkDir, onLog);
      if (result.exitCode !== 0) {
        throw new Error(`git clone failed with exit code ${result.exitCode}`);
      }
      return {
        workDir: target.remoteWorkDir,
        composeFile: config.composeFilePath ?? "docker-compose.yml"
      };
    }

    const result = await gitClone(repoUrl, branch, deploymentId, onLog);
    if (result.exitCode !== 0) {
      throw new Error(`git clone failed with exit code ${result.exitCode}`);
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
