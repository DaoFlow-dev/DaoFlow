/**
 * docker-executor.ts
 *
 * Backward-compatible barrel for Docker / Compose / git worker execution.
 * Split into focused modules to keep process execution, compose flows,
 * runtime/image commands, and git checkout concerns isolated.
 */

export { buildComposeCommandEnv } from "./compose-command-env";
export {
  execStreaming,
  STAGING_DIR,
  type ExecStreamingOptions,
  type LogLine,
  type OnLog
} from "./docker-exec-shared";
export {
  dockerComposeBuild,
  dockerComposeDown,
  dockerComposePs,
  dockerComposePull,
  dockerComposeUp
} from "./docker-compose-executor";
export {
  checkContainerHealth,
  createTarArchive,
  detectLocalRuntimeVersions,
  dockerBuild,
  dockerListImages,
  dockerLoad,
  dockerPull,
  dockerRemoveContainer,
  dockerRun,
  extractTarArchive,
  type DockerImageListEntry
} from "./docker-runtime-executor";
export {
  cleanupStagingDir,
  ensureStagingDir,
  getStagingArchivePath,
  gitClone,
  prepareClonedRepository,
  type GitCloneOptions
} from "./git-executor";
