/**
 * ssh-executor.ts — Re-export barrel for SSH modules.
 *
 * This file was split into:
 *  - ./ssh-connection.ts — SSH connection, key lifecycle, exec, SCP, shell quoting
 *  - ./ssh-compose.ts   — Remote Docker Compose commands
 *  - ./ssh-docker.ts    — Remote Docker commands (build, run, health, logs)
 *
 * All existing imports from "./ssh-executor" continue to work without changes.
 */

export { execRemote, sshArgs, type SSHTarget } from "./ssh-connection";

export { detectDockerVersion, testSSHConnection } from "./ssh-diagnostics";

export {
  scpDownload,
  scpUpload,
  type ScpTransferOptions,
  type ScpTransferResult
} from "./ssh-file-transfer";

export { writeSSHKey, removeSSHKey } from "./ssh-key-files";
export { shellQuote } from "./ssh-shell";

export {
  remoteDockerComposePull,
  remoteDockerComposeBuild,
  remoteDockerComposeUp,
  remoteDockerComposePs,
  remoteDockerComposeDown
} from "./ssh-compose";

export {
  remoteDockerStackDeploy,
  remoteDockerInspectSwarmTaskNetworkAddresses,
  remoteDockerStackRemove,
  remoteDockerStackServices,
  remoteDockerStackPs
} from "./ssh-swarm";

export {
  remoteDockerPull,
  remoteDockerRun,
  remoteDockerBuild,
  remoteDockerBuildMetadataWrapper,
  createRemoteDockerVolume,
  inspectRemoteDockerVolume,
  remoteGitClone,
  remoteEnsureDir,
  remoteExtractArchive,
  remoteCheckContainerHealth,
  remoteDockerLogs
} from "./ssh-docker";
