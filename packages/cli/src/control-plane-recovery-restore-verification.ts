import { waitForInstallHealth } from "./install-health";
import { getInstallWorkflowReadiness } from "./install-workflow-runtime";
import type { InstallWorkflowProfile } from "./install-workflow-profile";
import { signInWithEmailPassword } from "./login/identity-client";
import { createClient } from "./trpc-client";
import type { RecoveryRestoreRuntime } from "./control-plane-recovery-restore-runtime";

export interface RecoveredControlPlaneEvidence {
  viewer: { email: string; role: string };
  projectIds: string[];
  serverIds: string[];
  auditEntries: number;
  backupPolicyIds: string[];
  backupRunIds: string[];
}

export async function verifyRecoveredControlPlane(input: {
  runtime: RecoveryRestoreRuntime;
  port: number;
  workflowProfile: InstallWorkflowProfile;
  email: string;
  password: string;
}): Promise<RecoveredControlPlaneEvidence> {
  const readiness = getInstallWorkflowReadiness({
    workflowProfile: input.workflowProfile,
    phase: "startup"
  });
  const ready = await waitForInstallHealth({
    runtime: input.runtime,
    port: input.port,
    requiredWorkerDetail: readiness.requiredWorkerDetail
  });
  if (!ready) throw new Error("Recovered DaoFlow did not become ready before the timeout.");

  const baseUrl = `http://127.0.0.1:${input.port}`;
  const sessionToken = await signInWithEmailPassword(
    baseUrl,
    input.email,
    input.password,
    {},
    {
      fetch: (request, init) => input.runtime.fetch(request, init),
      sleep: (ms) => input.runtime.sleep(ms),
      prompt: async () => "",
      tryOpenBrowser: () => false
    }
  );
  const client = createClient({ apiUrl: baseUrl, token: sessionToken, authMethod: "session" });
  const [viewer, infrastructure, audit, backups] = await Promise.all([
    client.viewer.query(),
    client.infrastructureInventory.query(),
    client.auditTrail.query({ limit: 1 }),
    client.backupOverview.query({ limit: 50 })
  ]);

  return {
    viewer: { email: viewer.principal.email, role: viewer.authz.role },
    projectIds: infrastructure.projects.map((project) => project.id).sort(),
    serverIds: infrastructure.servers.map((server) => server.id).sort(),
    auditEntries: audit.summary.totalEntries,
    backupPolicyIds: backups.policies.map((policy) => policy.id).sort(),
    backupRunIds: backups.runs.map((run) => run.id).sort()
  };
}
