/**
 * ssh-executor.ts — Re-export barrel for SSH modules.
 *
 * This file was split into:
 *  - ./ssh-connection.ts — SSH connection, key lifecycle, exec, SCP, shell quoting
 *  - ./ssh-docker.ts    — Remote Docker commands (compose, build, run, health, logs)
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
  remoteDockerComposeUp,
  remoteDockerComposePs,
  remoteDockerComposeDown,
  remoteDockerPull,
  remoteDockerRun,
  remoteDockerBuild,
  remoteGitClone,
  remoteEnsureDir,
  remoteExtractArchive,
  remoteCheckContainerHealth,
  remoteDockerLogs
} from "./ssh-docker";
