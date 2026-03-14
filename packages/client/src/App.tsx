import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { canAssumeAnyRole, normalizeAppRole, type AppRole } from "@daoflow/shared";
import { useSession } from "./lib/auth-client";
import { trpc } from "./lib/trpc";
import { StatusCard } from "./components/status-card";
import { HeroSection } from "./features/dashboard/HeroSection";
import { AuthSection } from "./features/auth/AuthSection";
import { ServerReadiness } from "./features/infrastructure/ServerReadiness";
import { EnvironmentVariables } from "./features/infrastructure/EnvironmentVariables";
import { InfrastructureInventory } from "./features/infrastructure/InfrastructureInventory";
import { PersistentVolumes } from "./features/infrastructure/PersistentVolumes";
import { ComposeReleaseCatalog } from "./features/deployments/ComposeReleaseCatalog";
import { ComposeDrift } from "./features/deployments/ComposeDrift";
import { DeploymentList } from "./features/deployments/DeploymentList";
import { DeploymentInsights } from "./features/deployments/DeploymentInsights";
import { RollbackPlans } from "./features/deployments/RollbackPlans";
import { ExecutionHandoff } from "./features/deployments/ExecutionHandoff";
import { DeploymentLogs } from "./features/deployments/DeploymentLogs";
import { BackupCatalog } from "./features/backups/BackupCatalog";
import { ApprovalQueue } from "./features/admin/ApprovalQueue";
import { AuditTrail } from "./features/admin/AuditTrail";
import { TokenInventory } from "./features/admin/TokenInventory";

export default function App() {
  const session = useSession();
  const health = trpc.health.useQuery();
  const overview = trpc.platformOverview.useQuery();
  const roadmap = trpc.roadmap.useQuery({});

  // ── Authenticated queries ──────────────────────────────────────
  const enabled = Boolean(session.data);
  const composeReleaseCatalog = trpc.composeReleaseCatalog.useQuery({}, { enabled });
  const composeDriftReport = trpc.composeDriftReport.useQuery({}, { enabled });
  const approvalQueue = trpc.approvalQueue.useQuery({}, { enabled });
  const recentDeployments = trpc.recentDeployments.useQuery({ limit: 50 }, { enabled });
  const backupOverview = trpc.backupOverview.useQuery({}, { enabled });
  const backupRestoreQueue = trpc.backupRestoreQueue.useQuery({}, { enabled });
  const executionQueue = trpc.executionQueue.useQuery({ limit: 50 }, { enabled });
  const operationsTimeline = trpc.operationsTimeline.useQuery({ limit: 50 }, { enabled });
  const infrastructureInventory = trpc.infrastructureInventory.useQuery(undefined, { enabled });
  const serverReadiness = trpc.serverReadiness.useQuery({}, { enabled });
  const persistentVolumes = trpc.persistentVolumes.useQuery({}, { enabled });
  const deploymentInsights = trpc.deploymentInsights.useQuery({}, { enabled });
  const deploymentRollbackPlans = trpc.deploymentRollbackPlans.useQuery({ limit: 12 }, { enabled });
  const auditTrail = trpc.auditTrail.useQuery({ limit: 50 }, { enabled });
  const deploymentLogs = trpc.deploymentLogs.useQuery({}, { enabled });
  const environmentVariables = trpc.environmentVariables.useQuery({}, { enabled });

  const viewer = trpc.viewer.useQuery(undefined, { enabled });
  const adminControlPlane = trpc.adminControlPlane.useQuery(undefined, { enabled });
  const currentRole = viewer.data ? normalizeAppRole(viewer.data.authz.role) : "guest";
  const canViewAgentTokenInventory = canAssumeAnyRole(currentRole as AppRole, ["owner", "admin"]);
  const _principalInventory = trpc.principalInventory.useQuery(undefined, {
    enabled: canViewAgentTokenInventory
  });
  const agentTokenInventory = trpc.agentTokenInventory.useQuery(undefined, {
    enabled: canViewAgentTokenInventory
  });

  // ── Shared feedback state ──────────────────────────────────────
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);

  // ── Refresh all operational views at once ──────────────────────
  async function refreshOperationalViews() {
    await Promise.all([
      approvalQueue.refetch(),
      composeReleaseCatalog.refetch(),
      infrastructureInventory.refetch(),
      serverReadiness.refetch(),
      persistentVolumes.refetch(),
      recentDeployments.refetch(),
      deploymentInsights.refetch(),
      deploymentRollbackPlans.refetch(),
      auditTrail.refetch(),
      deploymentLogs.refetch(),
      environmentVariables.refetch(),
      backupOverview.refetch(),
      backupRestoreQueue.refetch(),
      executionQueue.refetch(),
      operationsTimeline.refetch()
    ]);
  }

  // ── Error messages ─────────────────────────────────────────────
  const errorMessage = (query: { error: unknown }) =>
    query.error && isTRPCClientError(query.error) ? query.error.message : null;

  // ── Permission helpers ─────────────────────────────────────────
  const canQueueDeployments = canAssumeAnyRole(currentRole as AppRole, [
    "owner",
    "admin",
    "operator",
    "developer"
  ]);
  const canOperateExecutionJobs = canAssumeAnyRole(currentRole as AppRole, [
    "owner",
    "admin",
    "operator"
  ]);
  const canRequestApprovals = canAssumeAnyRole(currentRole as AppRole, [
    "owner",
    "admin",
    "operator",
    "developer",
    "agent"
  ]);
  const canManageEnvironmentVariables = canQueueDeployments;
  const canManageServers = canAssumeAnyRole(currentRole as AppRole, ["owner", "admin"]);

  return (
    <main className="shell">
      <HeroSection
        session={session}
        health={health}
        overview={overview}
        viewer={viewer}
        currentRole={currentRole}
      />

      <AuthSection
        session={session}
        viewer={viewer}
        adminControlPlane={adminControlPlane}
        agentTokenInventory={agentTokenInventory}
        currentRole={currentRole}
        viewerMessage={errorMessage(viewer)}
        adminMessage={errorMessage(adminControlPlane)}
        onSignOut={() => setApprovalFeedback(null)}
      />

      <section className="grid">
        <StatusCard title="Control plane" items={overview.data?.architecture.controlPlane ?? []} />
        <StatusCard
          title="Execution plane"
          items={overview.data?.architecture.executionPlane ?? []}
        />
        <StatusCard title="Agent API lanes" items={overview.data?.guardrails.agentApiLanes ?? []} />
        <StatusCard
          title="Product principles"
          items={overview.data?.guardrails.productPrinciples ?? []}
        />
      </section>

      <InfrastructureInventory
        session={session}
        infrastructureInventory={infrastructureInventory}
        infrastructureMessage={errorMessage(infrastructureInventory)}
      />

      <ServerReadiness
        session={session}
        serverReadiness={serverReadiness}
        serverReadinessMessage={errorMessage(serverReadiness)}
        canManageServers={canManageServers}
        refreshOperationalViews={refreshOperationalViews}
      />

      <EnvironmentVariables
        session={session}
        environmentVariables={environmentVariables}
        environmentVariablesMessage={errorMessage(environmentVariables)}
        canManageEnvironmentVariables={canManageEnvironmentVariables}
        infrastructureInventory={infrastructureInventory}
        refreshOperationalViews={refreshOperationalViews}
      />

      <PersistentVolumes
        session={session}
        persistentVolumes={persistentVolumes}
        persistentVolumesMessage={errorMessage(persistentVolumes)}
      />

      <ComposeReleaseCatalog
        session={session}
        composeReleaseCatalog={composeReleaseCatalog}
        composeReleaseCatalogMessage={errorMessage(composeReleaseCatalog)}
        canQueueDeployments={canQueueDeployments}
        canRequestApprovals={canRequestApprovals}
        refreshOperationalViews={refreshOperationalViews}
        onApprovalFeedback={setApprovalFeedback}
      />

      <ComposeDrift
        session={session}
        composeDriftReport={composeDriftReport}
        composeDriftMessage={errorMessage(composeDriftReport)}
      />

      <DeploymentList
        session={session}
        recentDeployments={recentDeployments}
        deploymentMessage={errorMessage(recentDeployments)}
        canQueueDeployments={canQueueDeployments}
        refreshOperationalViews={refreshOperationalViews}
      />

      <DeploymentInsights
        session={session}
        deploymentInsights={deploymentInsights}
        insightsMessage={errorMessage(deploymentInsights)}
      />

      <RollbackPlans
        session={session}
        deploymentRollbackPlans={deploymentRollbackPlans}
        rollbackPlansMessage={errorMessage(deploymentRollbackPlans)}
      />

      <ExecutionHandoff
        session={session}
        executionQueue={executionQueue}
        executionQueueMessage={errorMessage(executionQueue)}
        operationsTimeline={operationsTimeline}
        timelineMessage={errorMessage(operationsTimeline)}
        canOperateExecutionJobs={canOperateExecutionJobs}
        refreshOperationalViews={refreshOperationalViews}
      />

      <AuditTrail
        session={session}
        auditTrail={auditTrail}
        auditMessage={errorMessage(auditTrail)}
      />

      <DeploymentLogs
        session={session}
        deploymentLogs={deploymentLogs}
        logsMessage={errorMessage(deploymentLogs)}
      />

      <BackupCatalog
        session={session}
        backupOverview={backupOverview}
        backupRestoreQueue={backupRestoreQueue}
        backupMessage={errorMessage(backupOverview)}
        backupRestoreMessage={errorMessage(backupRestoreQueue)}
        canOperateExecutionJobs={canOperateExecutionJobs}
        canRequestApprovals={canRequestApprovals}
        refreshOperationalViews={refreshOperationalViews}
        onApprovalFeedback={setApprovalFeedback}
      />

      <ApprovalQueue
        session={session}
        approvalQueue={approvalQueue}
        approvalMessage={errorMessage(approvalQueue)}
        canOperateExecutionJobs={canOperateExecutionJobs}
        refreshOperationalViews={refreshOperationalViews}
        externalFeedback={approvalFeedback}
      />

      <TokenInventory
        session={session}
        agentTokenInventory={agentTokenInventory}
        tokenMessage={errorMessage(agentTokenInventory)}
      />

      <section className="roadmap">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Research-driven roadmap</p>
          <h2>First implementation lane</h2>
        </div>

        <div className="roadmap__items">
          {roadmap.data?.map((item) => (
            <article className="roadmap-item" key={item.title}>
              <p className="roadmap-item__lane">{item.lane}</p>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
