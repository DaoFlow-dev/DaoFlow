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

export {
  execRemote,
  testSSHConnection,
  detectDockerVersion,
  writeSSHKey,
  removeSSHKey,
  scpUpload,
  sshArgs,
  shellQuote,
  type SSHTarget
} from "./ssh-connection";

export {
  remoteDockerComposePull,
  remoteDockerComposeBuild,
  remoteDockerComposeUp,
  remoteDockerComposePs,
  remoteDockerComposeDown
} from "./ssh-compose";

export {
  remoteDockerPull,
  remoteDockerRun,
  remoteDockerBuild,
  remoteGitClone,
  remoteEnsureDir,
  remoteExtractArchive,
  remoteCheckContainerHealth,
  remoteDockerLogs
} from "./ssh-docker";
