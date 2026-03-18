import { basename, dirname, isAbsolute, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
import {
  COMPOSE_ENV_FILE_NAME,
  buildMaterializedComposeEnvEvidence,
  buildComposeEnvArtifact,
  renderComposeEnvFile,
  type ComposeEnvEvidence,
  type ComposeEnvMaterializedEntry
} from "../compose-env";
import type { DeploymentComposeEnvState } from "../db/services/compose-env";

interface ComposeWorkspace {
  workDir: string;
  composeFile: string;
  composeEnv?: {
    composeEnv: ComposeEnvEvidence;
    payloadEntries: ComposeEnvMaterializedEntry[];
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

function readRepoDefaultEnvFile(workDir: string, composeFile: string): string | null {
  const composeDir = dirname(composeFile);
  const envPath = isAbsolute(composeDir)
    ? join(composeDir, ".env")
    : join(workDir, composeDir, ".env");
  return existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
}

function materializeComposeEnv(
  workDir: string,
  composeFile: string,
  branch: string,
  deploymentEnvState: DeploymentComposeEnvState,
  existingEvidence?: ComposeEnvEvidence
): {
  composeEnv: ComposeEnvEvidence;
  payloadEntries: ComposeEnvMaterializedEntry[];
} {
  if (deploymentEnvState.kind === "materialized") {
    writeFileSync(
      join(workDir, COMPOSE_ENV_FILE_NAME),
      renderComposeEnvFile(deploymentEnvState.entries),
      {
        mode: 0o600
      }
    );

    return {
      composeEnv:
        existingEvidence?.status === "materialized"
          ? existingEvidence
          : buildMaterializedComposeEnvEvidence(branch, deploymentEnvState.entries),
      payloadEntries: deploymentEnvState.entries
    };
  }

  const artifact = buildComposeEnvArtifact({
    branch,
    repoDefaultContent: readRepoDefaultEnvFile(workDir, composeFile),
    deploymentEntries: deploymentEnvState.entries
  });

  writeFileSync(join(workDir, COMPOSE_ENV_FILE_NAME), artifact.envFileContents, {
    mode: 0o600
  });

  return {
    composeEnv: artifact.composeEnv,
    payloadEntries: artifact.payloadEntries
  };
}

export async function prepareComposeWorkspace(
  deploymentId: string,
  config: ConfigSnapshot,
  target: ExecutionTarget,
  onLog: OnLog,
  deploymentEnvState: DeploymentComposeEnvState = { kind: "queued", entries: [] }
): Promise<ComposeWorkspace> {
  if (!isUploadedCompose(config)) {
    const checkout = await resolveCheckoutSpec(config);
    if (!checkout) {
      throw new Error(
        "Compose deployment requires either uploaded artifacts or a repository source definition."
      );
    }

    // Git-backed compose deploys always materialize locally so checked-in .env defaults
    // become part of the frozen deployment artifact, even when DaoFlow adds no overrides.
    const requiresComposeEnvMaterialization = Boolean(config.composeEnv);

    if (target.mode === "remote") {
      if (checkout.requiresLocalMaterialization || requiresComposeEnvMaterialization) {
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

        const composeEnv = materializeComposeEnv(
          localClone.workDir,
          config.composeFilePath ?? "docker-compose.yml",
          checkout.branch,
          deploymentEnvState,
          config.composeEnv
        );

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
          composeFile: config.composeFilePath ?? "docker-compose.yml",
          composeEnv
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
    const composeEnv = materializeComposeEnv(
      result.workDir,
      config.composeFilePath ?? "docker-compose.yml",
      checkout.branch,
      deploymentEnvState,
      config.composeEnv
    );
    return {
      workDir: result.workDir,
      composeFile: config.composeFilePath ?? "docker-compose.yml",
      composeEnv
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

    const composeEnv =
      deploymentEnvState.entries.length > 0
        ? materializeComposeEnv(
            localStageDir,
            composeFile,
            "main",
            deploymentEnvState,
            config.composeEnv
          )
        : undefined;

    return {
      workDir: localStageDir,
      composeFile,
      composeEnv
    };
  }

  const ensureDirResult = await remoteEnsureDir(target.ssh, target.remoteWorkDir, onLog);
  if (ensureDirResult.exitCode !== 0) {
    throw new Error(`Failed to prepare remote workspace ${target.remoteWorkDir}.`);
  }

  if (contextArchive) {
    if (deploymentEnvState.entries.length > 0) {
      const extractResult = await extractTarArchive(
        join(localStageDir, contextArchive),
        localStageDir,
        onLog
      );
      if (extractResult.exitCode !== 0) {
        throw new Error(
          `Failed to extract uploaded context archive locally for deployment ${deploymentId}.`
        );
      }
    }

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

  const composeEnv =
    deploymentEnvState.entries.length > 0
      ? materializeComposeEnv(
          localStageDir,
          composeFile,
          "main",
          deploymentEnvState,
          config.composeEnv
        )
      : undefined;

  if (composeEnv) {
    const localEnvPath = join(localStageDir, COMPOSE_ENV_FILE_NAME);
    const remoteEnvPath = join(target.remoteWorkDir, COMPOSE_ENV_FILE_NAME);
    const uploadEnv = await scpUpload(target.ssh, localEnvPath, remoteEnvPath, onLog);
    if (uploadEnv.exitCode !== 0) {
      throw new Error(
        `Failed to upload compose environment variables for deployment ${deploymentId}.`
      );
    }
  }

  return {
    workDir: target.remoteWorkDir,
    composeFile,
    composeEnv
  };
}
