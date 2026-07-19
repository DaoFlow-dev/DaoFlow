import type { Page } from "@playwright/test";
import { signInAsOwner } from "../../helpers";
import {
  realInfraTrpc,
  uploadCompose,
  waitForBackupRun,
  waitForDeployment,
  waitForRestore
} from "./api";
import { assertLifecycleMutationAudit } from "./audit";
import type { RealInfraArtifacts } from "./artifacts";
import { invalidCompose, validCompose } from "./compose";
import type { RealInfraConfig } from "./config";
import type { RealInfraNames } from "./names";
import {
  assertRemoteServiceHealthy,
  assertSentinel,
  assertSentinelMissing,
  destroySentinel,
  writeSentinel
} from "./remote";
import type { PinnedSshSession } from "./ssh";

export interface RealInfraLifecycleState {
  serverId?: string;
  projectId?: string;
  environmentId?: string;
  serviceId?: string;
  destinationId?: string;
  volumeId?: string;
  policyId?: string;
  backupRunId?: string;
  restoreId?: string;
}

export interface LifecycleEvidence {
  failedDeploymentId: string;
  eventId: string;
  logId: string;
}

export async function executeLifecycle(input: {
  page: Page;
  config: RealInfraConfig;
  names: RealInfraNames;
  session: PinnedSshSession;
  artifacts: RealInfraArtifacts;
  state: RealInfraLifecycleState;
}): Promise<LifecycleEvidence> {
  const { page, config, names, session, artifacts, state } = input;
  if (config.s3.prefix !== names.s3Prefix) {
    throw new Error("The S3 prefix is not scoped to the current run token.");
  }
  await step(artifacts, "verify-marker-before-mutation", async () => session.verifyMarker());
  await signInAsOwner(page);

  const server = await step(artifacts, "register-server", async () =>
    mutate<{ id: string }>(page, "registerServer", {
      name: names.server,
      host: config.ssh.host,
      region: "real-infra",
      sshPort: config.ssh.port,
      sshUser: config.ssh.user,
      sshPrivateKey: config.ssh.privateKey,
      kind: "docker-engine"
    })
  );
  state.serverId = server.id;

  const scan = await step(artifacts, "scan-exact-ssh-identity", async () =>
    mutate<{
      identities: Array<{ id: string; algorithm: string; publicKey: string; fingerprint: string }>;
    }>(page, "scanServerSshHostIdentities", { serverId: server.id })
  );
  const selected = scan.identities.find(
    (identity) =>
      identity.algorithm === config.ssh.hostKey.algorithm &&
      identity.publicKey === config.ssh.hostKey.publicKey
  );
  if (!selected) throw new Error("The exact pinned SSH identity was not discovered.");

  await step(artifacts, "approve-exact-ssh-identity-and-readiness", async () => {
    const approval = await mutate<{
      server: {
        status?: string;
        metadata?: { readinessCheck?: { issues?: unknown } };
      };
    }>(page, "approveServerSshHostIdentity", {
      serverId: server.id,
      identityId: selected.id,
      algorithm: selected.algorithm,
      publicKey: selected.publicKey,
      fingerprint: selected.fingerprint
    });
    if (approval.server.status !== "ready") {
      const issues = approval.server.metadata?.readinessCheck?.issues;
      const reason = Array.isArray(issues)
        ? issues.filter((issue): issue is string => typeof issue === "string").join(" ")
        : "Readiness checks did not pass.";
      throw new Error(`Registered remote server is not ready. ${reason}`);
    }
  });

  const valid = await step(artifacts, "deploy-valid-compose", async () =>
    uploadCompose(page, {
      serverId: server.id,
      environment: names.environment,
      compose: validCompose(names)
    })
  );
  state.projectId = valid.projectId;
  state.environmentId = valid.environmentId;
  state.serviceId = valid.serviceId;
  await step(artifacts, "verify-valid-deployment", async () => {
    await waitForDeployment(page, valid.deploymentId, "healthy");
    await assertRemoteServiceHealthy(session, names);
  });
  await step(artifacts, "write-sentinel", async () => writeSentinel(session, names));

  const destination = await step(artifacts, "create-s3-destination", async () =>
    mutate<{ id: string }>(page, "createBackupDestination", {
      name: names.destination,
      provider: "s3",
      accessKey: config.s3.accessKey,
      secretAccessKey: config.s3.secretAccessKey,
      bucket: config.s3.bucket,
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      s3Provider: "Minio",
      rcloneRemotePath: names.s3Prefix,
      encryptionMode: "none"
    })
  );
  state.destinationId = destination.id;
  const volume = await step(artifacts, "register-owned-volume", async () =>
    mutate<{ id: string }>(page, "createVolume", {
      name: names.volume,
      serverId: server.id,
      serviceId: valid.serviceId,
      mountPath: `${config.workspaceRoot}/volume`,
      driver: "local"
    })
  );
  state.volumeId = volume.id;
  const policy = await step(artifacts, "create-backup-policy", async () =>
    mutate<{ id: string }>(page, "createBackupPolicy", {
      name: names.policy,
      volumeId: volume.id,
      destinationId: destination.id,
      backupType: "volume",
      retentionDays: 1,
      maxBackups: 1
    })
  );
  state.policyId = policy.id;
  await step(artifacts, "verify-written-sentinel", async () => assertSentinel(session, names));
  const backup = await step(artifacts, "backup-owned-volume", async () =>
    mutate<{ id: string }>(page, "triggerBackupNow", { policyId: policy.id })
  );
  state.backupRunId = backup.id;
  await step(artifacts, "verify-backup", async () =>
    waitForBackupRun(page, backup.id, "succeeded")
  );

  const failed = await step(artifacts, "deploy-invalid-image", async () =>
    uploadCompose(page, {
      serverId: server.id,
      project: valid.projectId,
      environment: names.environment,
      compose: invalidCompose(names)
    })
  );
  const evidence = await step(artifacts, "diagnose-failed-deployment", async () => {
    const detail = await waitForDeployment(page, failed.deploymentId, "failed");
    const guidance = detail.recoveryGuidance as
      | {
          evidence?: Array<{ eventId?: number | null; logId?: number | null }>;
          evidenceIds?: string[];
        }
      | undefined;
    const eventId = guidance?.evidence?.find((item) => typeof item.eventId === "number")?.eventId;
    const logId = guidance?.evidence?.find((item) => typeof item.logId === "number")?.logId;
    const evidenceIds = guidance?.evidenceIds ?? [];
    if (
      typeof eventId !== "number" ||
      typeof logId !== "number" ||
      !evidenceIds.includes(`event:${eventId}`) ||
      !evidenceIds.includes(`deployment-log:${logId}`)
    ) {
      throw new Error("Deployment diagnosis did not include exact persisted evidence IDs.");
    }
    const [logs, timeline] = await Promise.all([
      realInfraTrpc<{ lines?: Array<{ id?: string }> }>(page, "deploymentLogs", {
        deploymentId: failed.deploymentId,
        limit: 50
      }),
      realInfraTrpc<{ events?: Array<{ id?: string; resourceId?: string; kind?: string }> }>(
        page,
        "eventTimeline",
        { limit: 200, since: "10m" }
      )
    ]);
    if (
      !logs.lines?.some((line) => line.id === `deployment_log_${logId}`) ||
      !timeline.events?.some(
        (event) =>
          event.id === `event_${eventId}` &&
          event.resourceId === failed.deploymentId &&
          event.kind === "deployment.failed"
      )
    ) {
      throw new Error("Exact persisted deployment evidence IDs are not retrievable.");
    }
    return {
      failedDeploymentId: failed.deploymentId,
      eventId: `event:${eventId}`,
      logId: `deployment-log:${logId}`
    };
  });

  const rollback = await step(artifacts, "rollback-to-known-good", async () =>
    mutate<{ id: string }>(page, "executeRollback", {
      serviceId: valid.serviceId,
      targetDeploymentId: valid.deploymentId
    })
  );
  await step(artifacts, "verify-rollback-remote-state", async () => {
    await waitForDeployment(page, rollback.id, "healthy");
    await assertRemoteServiceHealthy(session, names);
  });
  await step(artifacts, "delete-sentinel", async () => {
    await destroySentinel(session, names);
    await assertSentinelMissing(session, names);
  });
  const restore = await step(artifacts, "restore-owned-volume", async () =>
    mutate<{ id: string }>(page, "queueBackupRestore", { backupRunId: backup.id })
  );
  state.restoreId = restore.id;
  await step(artifacts, "verify-restored-sentinel", async () => {
    await waitForRestore(page, restore.id);
    await assertSentinel(session, names);
  });
  await step(artifacts, "verify-lifecycle-audit", async () => assertLifecycleMutationAudit(page));
  return evidence;
}

async function mutate<T>(
  page: Page,
  procedure: string,
  input: Record<string, unknown>
): Promise<T> {
  return realInfraTrpc<T>(page, procedure, input).catch(() => {
    throw new Error(`Control-plane mutation failed: ${procedure}.`);
  });
}

async function step<T>(
  artifacts: RealInfraArtifacts,
  name: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    const result = await run();
    await artifacts.outcome(name, "passed");
    return result;
  } catch (error) {
    await artifacts.outcome(name, "failed", {
      reason: error instanceof Error ? error.message : "The lifecycle step failed."
    });
    throw error;
  }
}
