/**
 * Phase 5: Compose & Multi-Service Backup Support
 * Task #33: Compose service backup — iterate over compose services, backup each persistent volume
 * Task #34: Compose backup policy — policy targeting project+environment
 * Task #35: Backup all volumes — server-level bulk backup
 * Task #36: Backup groups
 * Task #37: Cross-server backup stub
 * Task #38: Export package stub
 */

/**
 * Task #33: Discover persistent volumes from a docker-compose service.
 * Parses compose YAML to find all named volumes for backup.
 */
export function discoverComposeVolumes(composeYaml: string): string[] {
  const volumes: string[] = [];
  const lines = composeYaml.split("\n");

  let inVolumes = false;
  for (const line of lines) {
    const trimmed = line.trim();
    // Top-level volumes section
    if (/^volumes:/.test(trimmed)) {
      inVolumes = true;
      continue;
    }
    if (inVolumes && /^\S/.test(trimmed)) {
      inVolumes = false;
    }
    if (inVolumes && trimmed.endsWith(":")) {
      volumes.push(trimmed.slice(0, -1).trim());
    }
  }

  return volumes;
}

/**
 * Task #34: Generate backup policies for all volumes in a compose project.
 */
export function generateComposePolicies(params: {
  projectId: string;
  environmentId: string;
  volumeNames: string[];
  schedule: string;
  destinationId: string;
}) {
  return params.volumeNames.map((volumeName) => ({
    name: `compose-${volumeName}`,
    volumeName,
    projectId: params.projectId,
    environmentId: params.environmentId,
    schedule: params.schedule,
    destinationId: params.destinationId,
    backupType: "volume" as const
  }));
}

/**
 * Task #35: Generate bulk backup plan for all named volumes on a server.
 */
export function generateBulkVolumePlan(params: {
  serverId: string;
  volumeNames: string[];
  destinationId: string;
  schedule: string;
}) {
  return params.volumeNames.map((name) => ({
    serverId: params.serverId,
    volumeName: name,
    destinationId: params.destinationId,
    schedule: params.schedule,
    action: "create_policy" as const
  }));
}

/**
 * Task #36: Backup group model — group multiple policies together.
 */
export interface BackupGroup {
  id: string;
  name: string;
  description: string;
  policyIds: string[];
}

/**
 * Task #37: Cross-server backup stub.
 * In production, this would pipe data from server A through rclone to destination on server B.
 */
export function planCrossServerBackup(params: {
  sourceServerId: string;
  targetServerId: string;
  volumeName: string;
}) {
  return {
    type: "cross-server" as const,
    source: params.sourceServerId,
    target: params.targetServerId,
    volume: params.volumeName,
    steps: [
      "SSH to source server",
      "Create volume archive via docker",
      "Pipe through rclone to target destination",
      "Verify integrity on target",
      "Record backup run"
    ]
  };
}

/**
 * Task #38: Export package — bundle compose.yaml + all volume backups into a single downloadable tar.
 */
export function planExportPackage(params: {
  projectId: string;
  composeYaml: string;
  backupRunIds: string[];
}) {
  return {
    type: "export-package" as const,
    projectId: params.projectId,
    contents: [
      "compose.yaml (original)",
      ...params.backupRunIds.map((id) => `backup-artifact-${id}.tar.gz`),
      "manifest.json (metadata)"
    ],
    format: "tar.gz"
  };
}
