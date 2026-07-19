import type { Page } from "@playwright/test";
import { realInfraTrpc } from "./api";

export async function assertLifecycleMutationAudit(page: Page): Promise<void> {
  const audit = await realInfraTrpc<{ entries?: Array<{ action?: string }> }>(page, "auditTrail", {
    limit: 50,
    since: "10m"
  });
  const recordedActions = audit.entries?.map((entry) => entry.action).filter(Boolean) ?? [];
  const actions = new Set(recordedActions);
  for (const action of [
    "server.register",
    "server.ssh-host-identity.observe",
    "server.ssh-host-identity.approve",
    "project.create",
    "environment.create",
    "service.create",
    "deployment.create",
    "deployment.execute",
    "destination.create",
    "volume.create",
    "backup-policy.create",
    "backup.trigger",
    "backup.restore.queue",
    "restore.execute"
  ]) {
    if (!actions.has(action)) {
      throw new Error(`An expected mutation audit record is missing: ${action}.`);
    }
  }
  if (recordedActions.filter((action) => action === "deployment.create").length < 3) {
    throw new Error("Each deployment mutation did not record an audit entry.");
  }
}

export async function assertCleanupMutationAudit(page: Page): Promise<void> {
  const audit = await realInfraTrpc<{ entries?: Array<{ action?: string }> }>(page, "auditTrail", {
    limit: 50,
    since: "10m"
  });
  const actions = new Set(audit.entries?.map((entry) => entry.action).filter(Boolean) ?? []);
  for (const action of [
    "backup-policy.delete",
    "volume.delete",
    "destination.delete",
    "service.delete",
    "environment.delete",
    "project.delete",
    "server.delete"
  ]) {
    if (!actions.has(action)) {
      throw new Error(`An expected mutation audit record is missing: ${action}.`);
    }
  }
}
