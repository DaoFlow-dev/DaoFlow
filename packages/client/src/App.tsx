import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { useSession } from "./lib/auth-client";
import { trpc } from "./lib/trpc";
import { StatusCard } from "./components/status-card";
import {
  getInventoryTone,
  getExecutionJobTone,
  getTimelineLifecycle,
  getTimelineTone,
  getAuditTone,
  getLogTone,
  getPersistentVolumeTone,
  getComposeDriftTone,
  formatBytes
} from "./lib/tone-utils";
import { HeroSection } from "./features/dashboard/HeroSection";
import { AuthSection } from "./features/auth/AuthSection";
import { ServerReadiness } from "./features/infrastructure/ServerReadiness";
import { EnvironmentVariables } from "./features/infrastructure/EnvironmentVariables";
import { BackupCatalog } from "./features/backups/BackupCatalog";
import { ApprovalQueue } from "./features/admin/ApprovalQueue";

export default function App() {
  const session = useSession();
  const health = trpc.health.useQuery();
  const overview = trpc.platformOverview.useQuery();
  const roadmap = trpc.roadmap.useQuery({});
  const composeReleaseCatalog = trpc.composeReleaseCatalog.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const composeDriftReport = trpc.composeDriftReport.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const approvalQueue = trpc.approvalQueue.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const requestApproval = trpc.requestApproval.useMutation();
  const queueComposeRelease = trpc.queueComposeRelease.useMutation();
  const createDeploymentRecord = trpc.createDeploymentRecord.useMutation();
  const dispatchExecutionJob = trpc.dispatchExecutionJob.useMutation();
  const completeExecutionJob = trpc.completeExecutionJob.useMutation();
  const failExecutionJob = trpc.failExecutionJob.useMutation();
  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    {
      enabled: Boolean(session.data)
    }
  );
  const backupOverview = trpc.backupOverview.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const backupRestoreQueue = trpc.backupRestoreQueue.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const executionQueue = trpc.executionQueue.useQuery(
    { limit: 50 },
    {
      enabled: Boolean(session.data)
    }
  );
  const operationsTimeline = trpc.operationsTimeline.useQuery(
    { limit: 50 },
    {
      enabled: Boolean(session.data)
    }
  );
  const infrastructureInventory = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const serverReadiness = trpc.serverReadiness.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const persistentVolumes = trpc.persistentVolumes.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const deploymentInsights = trpc.deploymentInsights.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const deploymentRollbackPlans = trpc.deploymentRollbackPlans.useQuery(
    { limit: 12 },
    {
      enabled: Boolean(session.data)
    }
  );
  const auditTrail = trpc.auditTrail.useQuery(
    { limit: 50 },
    {
      enabled: Boolean(session.data)
    }
  );
  const deploymentLogs = trpc.deploymentLogs.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );
  const environmentVariables = trpc.environmentVariables.useQuery(
    {},
    {
      enabled: Boolean(session.data)
    }
  );

  const viewer = trpc.viewer.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const adminControlPlane = trpc.adminControlPlane.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const currentRole = viewer.data?.authz.role ?? "guest";
  const canViewAgentTokenInventory = currentRole === "owner" || currentRole === "admin";
  const principalInventory = trpc.principalInventory.useQuery(undefined, {
    enabled: canViewAgentTokenInventory
  });
  const agentTokenInventory = trpc.agentTokenInventory.useQuery(undefined, {
    enabled: canViewAgentTokenInventory
  });
  const [serviceName, setServiceName] = useState("edge-worker");
  const [commitSha, setCommitSha] = useState("abcdef1");
  const [imageTag, setImageTag] = useState("ghcr.io/daoflow/edge-worker:0.2.0");
  const [composeReleaseTargetId, setComposeReleaseTargetId] = useState(
    "compose_daoflow_prod_control_plane"
  );
  const [composeReleaseCommitSha, setComposeReleaseCommitSha] = useState("abcdef1");
  const [composeReleaseImageTag, setComposeReleaseImageTag] = useState("");
  const [deploymentFeedback, setDeploymentFeedback] = useState<string | null>(null);
  const [composeReleaseFeedback, setComposeReleaseFeedback] = useState<string | null>(null);
  const [executionFeedback, setExecutionFeedback] = useState<string | null>(null);
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);

  async function refreshOperationalViews() {
    await approvalQueue.refetch();
    await composeReleaseCatalog.refetch();
    await infrastructureInventory.refetch();
    await serverReadiness.refetch();
    await persistentVolumes.refetch();
    await recentDeployments.refetch();
    await deploymentInsights.refetch();
    await deploymentRollbackPlans.refetch();
    await auditTrail.refetch();
    await deploymentLogs.refetch();
    await environmentVariables.refetch();
    await backupOverview.refetch();
    await backupRestoreQueue.refetch();
    await executionQueue.refetch();
    await operationsTimeline.refetch();
  }

  async function handleQueueComposeRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setComposeReleaseFeedback(null);

    try {
      const deployment = (await queueComposeRelease.mutateAsync({
        composeServiceId: composeReleaseTargetId,
        commitSha: composeReleaseCommitSha,
        imageTag: composeReleaseImageTag || undefined
      })) as { serviceName: string; id: string } | null;

      await refreshOperationalViews();
      setComposeReleaseFeedback(
        deployment
          ? `Queued compose release for ${deployment.serviceName} as ${deployment.id}.`
          : "Compose service not found."
      );
    } catch (error) {
      setComposeReleaseFeedback(
        isTRPCClientError(error) ? error.message : "Unable to queue the compose release right now."
      );
    }
  }

  async function handleRequestComposeReleaseApproval() {
    setApprovalFeedback(null);

    try {
      const request = await requestApproval.mutateAsync({
        actionType: "compose-release",
        composeServiceId: composeReleaseTargetId,
        commitSha: composeReleaseCommitSha,
        imageTag: composeReleaseImageTag || undefined,
        reason: "Require an explicit second reviewer before executing this Compose release."
      });
      await refreshOperationalViews();
      setApprovalFeedback(
        `Requested approval for ${request.actionType} on ${request.targetResource}.`
      );
    } catch (error) {
      setApprovalFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to request approval for this Compose release right now."
      );
    }
  }

  async function handleCreateDeployment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeploymentFeedback(null);

    try {
      const deployment = await createDeploymentRecord.mutateAsync({
        projectName: "DaoFlow",
        environmentName: "staging",
        serviceName,
        sourceType: "dockerfile",
        targetServerId: "srv_foundation_1",
        commitSha,
        imageTag,
        steps: [
          {
            label: "Render runtime spec",
            detail: `Freeze the Dockerfile inputs for ${serviceName} in staging.`
          },
          {
            label: "Queue execution handoff",
            detail: "Wait for the future execution-plane worker to pick up the job."
          }
        ]
      });

      await refreshOperationalViews();
      setDeploymentFeedback(`Queued ${deployment.serviceName} as ${deployment.id}.`);
    } catch (error) {
      setDeploymentFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to queue the deployment record right now."
      );
    }
  }

  async function handleDispatchJob(jobId: string, service: string) {
    setExecutionFeedback(null);

    try {
      await dispatchExecutionJob.mutateAsync({
        jobId
      });
      await refreshOperationalViews();
      setExecutionFeedback(`Dispatched ${service} to the execution worker.`);
    } catch (error) {
      setExecutionFeedback(
        isTRPCClientError(error) ? error.message : "Unable to dispatch the execution job right now."
      );
    }
  }

  async function handleCompleteJob(jobId: string, service: string) {
    setExecutionFeedback(null);

    try {
      await completeExecutionJob.mutateAsync({
        jobId
      });
      await refreshOperationalViews();
      setExecutionFeedback(`Marked ${service} healthy.`);
    } catch (error) {
      setExecutionFeedback(
        isTRPCClientError(error) ? error.message : "Unable to complete the execution job right now."
      );
    }
  }

  async function handleFailJob(jobId: string, service: string) {
    setExecutionFeedback(null);

    try {
      await failExecutionJob.mutateAsync({
        jobId,
        reason: `${service} failed the simulated worker rollout.`
      });
      await refreshOperationalViews();
      setExecutionFeedback(`Marked ${service} failed.`);
    } catch (error) {
      setExecutionFeedback(
        isTRPCClientError(error) ? error.message : "Unable to fail the execution job right now."
      );
    }
  }

  const viewerMessage =
    viewer.error && isTRPCClientError(viewer.error) ? viewer.error.message : null;
  const adminMessage =
    adminControlPlane.error && isTRPCClientError(adminControlPlane.error)
      ? adminControlPlane.error.message
      : null;
  const deploymentMessage =
    recentDeployments.error && isTRPCClientError(recentDeployments.error)
      ? recentDeployments.error.message
      : null;
  const backupMessage =
    backupOverview.error && isTRPCClientError(backupOverview.error)
      ? backupOverview.error.message
      : null;
  const backupRestoreMessage =
    backupRestoreQueue.error && isTRPCClientError(backupRestoreQueue.error)
      ? backupRestoreQueue.error.message
      : null;
  const executionQueueMessage =
    executionQueue.error && isTRPCClientError(executionQueue.error)
      ? executionQueue.error.message
      : null;
  const timelineMessage =
    operationsTimeline.error && isTRPCClientError(operationsTimeline.error)
      ? operationsTimeline.error.message
      : null;
  const infrastructureMessage =
    infrastructureInventory.error && isTRPCClientError(infrastructureInventory.error)
      ? infrastructureInventory.error.message
      : null;
  const composeReleaseCatalogMessage =
    composeReleaseCatalog.error && isTRPCClientError(composeReleaseCatalog.error)
      ? composeReleaseCatalog.error.message
      : null;
  const composeDriftMessage =
    composeDriftReport.error && isTRPCClientError(composeDriftReport.error)
      ? composeDriftReport.error.message
      : null;
  const approvalMessage =
    approvalQueue.error && isTRPCClientError(approvalQueue.error)
      ? approvalQueue.error.message
      : null;
  const serverReadinessMessage =
    serverReadiness.error && isTRPCClientError(serverReadiness.error)
      ? serverReadiness.error.message
      : null;
  const persistentVolumesMessage =
    persistentVolumes.error && isTRPCClientError(persistentVolumes.error)
      ? persistentVolumes.error.message
      : null;
  const insightsMessage =
    deploymentInsights.error && isTRPCClientError(deploymentInsights.error)
      ? deploymentInsights.error.message
      : null;
  const rollbackPlansMessage =
    deploymentRollbackPlans.error && isTRPCClientError(deploymentRollbackPlans.error)
      ? deploymentRollbackPlans.error.message
      : null;
  const auditMessage =
    auditTrail.error && isTRPCClientError(auditTrail.error) ? auditTrail.error.message : null;
  const logsMessage =
    deploymentLogs.error && isTRPCClientError(deploymentLogs.error)
      ? deploymentLogs.error.message
      : null;
  const environmentVariablesMessage =
    environmentVariables.error && isTRPCClientError(environmentVariables.error)
      ? environmentVariables.error.message
      : null;
  const tokenMessage =
    agentTokenInventory.error && isTRPCClientError(agentTokenInventory.error)
      ? agentTokenInventory.error.message
      : null;
  const _principalMessage =
    principalInventory.error && isTRPCClientError(principalInventory.error)
      ? principalInventory.error.message
      : null;
  const canQueueDeployments =
    currentRole === "owner" ||
    currentRole === "admin" ||
    currentRole === "operator" ||
    currentRole === "developer";
  const canOperateExecutionJobs =
    currentRole === "owner" || currentRole === "admin" || currentRole === "operator";
  const canRequestApprovals =
    currentRole === "owner" ||
    currentRole === "admin" ||
    currentRole === "operator" ||
    currentRole === "developer" ||
    currentRole === "agent";
  const canManageEnvironmentVariables = canQueueDeployments;
  const canManageServers = currentRole === "owner" || currentRole === "admin";
  const executionMutationPending =
    dispatchExecutionJob.isPending || completeExecutionJob.isPending || failExecutionJob.isPending;
  const approvalMutationPending = requestApproval.isPending;
  const composeReleaseMutationPending = queueComposeRelease.isPending;

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
        viewerMessage={viewerMessage}
        adminMessage={adminMessage}
        onSignOut={() => {
          setDeploymentFeedback(null);
          setComposeReleaseFeedback(null);
          setExecutionFeedback(null);
          setApprovalFeedback(null);
        }}
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

      <section className="infrastructure-inventory">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Inventory slice</p>
          <h2>Servers, projects, and environments</h2>
        </div>

        {session.data && infrastructureInventory.data ? (
          <>
            <div className="inventory-summary" data-testid="inventory-summary">
              <div className="token-summary__item">
                <span className="metric__label">Servers</span>
                <strong>{infrastructureInventory.data.summary.totalServers}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Projects</span>
                <strong>{infrastructureInventory.data.summary.totalProjects}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Environments</span>
                <strong>{infrastructureInventory.data.summary.totalEnvironments}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Healthy servers</span>
                <strong>{infrastructureInventory.data.summary.healthyServers}</strong>
              </div>
            </div>

            <div className="inventory-columns">
              <div className="inventory-column">
                <div className="inventory-column__header">
                  <p className="roadmap-item__lane">Managed targets</p>
                  <h3>Servers</h3>
                </div>
                <div className="inventory-list">
                  {infrastructureInventory.data.servers.map((server) => (
                    <article
                      className="token-card"
                      data-testid={`server-card-${server.id}`}
                      key={server.id}
                    >
                      <div className="token-card__top">
                        <div>
                          <p className="roadmap-item__lane">{server.kind}</p>
                          <h3>{server.name}</h3>
                        </div>
                        <span
                          className={`deployment-status deployment-status--${getInventoryTone(server.status)}`}
                        >
                          {server.status}
                        </span>
                      </div>
                      <p className="deployment-card__meta">
                        {server.host} · {server.region} · SSH {server.sshPort}
                      </p>
                      <p className="deployment-card__meta">
                        {server.engineVersion} · {server.environmentCount} attached environments
                      </p>
                      <p className="deployment-card__meta">
                        Last heartbeat: {server.lastHeartbeatAt ?? "No heartbeat recorded"}
                      </p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="inventory-column">
                <div className="inventory-column__header">
                  <p className="roadmap-item__lane">Deployment surfaces</p>
                  <h3>Projects</h3>
                </div>
                <div className="inventory-list">
                  {infrastructureInventory.data.projects.map((project) => (
                    <article
                      className="token-card"
                      data-testid={`project-card-${project.id}`}
                      key={project.id}
                    >
                      <div className="token-card__top">
                        <div>
                          <p className="roadmap-item__lane">{project.defaultBranch}</p>
                          <h3>{project.name}</h3>
                        </div>
                        <span
                          className={`deployment-status deployment-status--${getInventoryTone(project.latestDeploymentStatus)}`}
                        >
                          {project.latestDeploymentStatus}
                        </span>
                      </div>
                      <p className="deployment-card__meta">{project.repositoryUrl}</p>
                      <p className="deployment-card__meta">
                        {project.serviceCount} services · {project.environmentCount} environments
                      </p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="inventory-column">
                <div className="inventory-column__header">
                  <p className="roadmap-item__lane">Compose topology</p>
                  <h3>Environments</h3>
                </div>
                <div className="inventory-list">
                  {infrastructureInventory.data.environments.map((environment) => (
                    <article
                      className="timeline-event"
                      data-testid={`environment-card-${environment.id}`}
                      key={environment.id}
                    >
                      <div className="timeline-event__top">
                        <div>
                          <p className="roadmap-item__lane">{environment.projectName}</p>
                          <h3>{environment.name}</h3>
                        </div>
                        <span
                          className={`deployment-status deployment-status--${getInventoryTone(environment.status)}`}
                        >
                          {environment.status}
                        </span>
                      </div>
                      <p className="deployment-card__meta">
                        {environment.targetServerName} · Network {environment.networkName}
                      </p>
                      <p className="deployment-card__meta">{environment.composeFilePath}</p>
                      <p className="deployment-card__meta">
                        {environment.serviceCount} Compose services
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {infrastructureMessage ??
              "Sign in to inspect managed servers, projects, and environments."}
          </p>
        )}
      </section>

      <ServerReadiness
        session={session}
        serverReadiness={serverReadiness}
        serverReadinessMessage={serverReadinessMessage}
        canManageServers={canManageServers}
        refreshOperationalViews={refreshOperationalViews}
      />

      <EnvironmentVariables
        session={session}
        environmentVariables={environmentVariables}
        environmentVariablesMessage={environmentVariablesMessage}
        canManageEnvironmentVariables={canManageEnvironmentVariables}
        infrastructureInventory={infrastructureInventory}
        refreshOperationalViews={refreshOperationalViews}
      />

      <section className="persistent-volumes">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Stateful services</p>
          <h2>Persistent volume registry</h2>
        </div>

        {session.data && persistentVolumes.data ? (
          <>
            <div className="persistent-volume-summary" data-testid="persistent-volume-summary">
              <div className="token-summary__item">
                <span className="metric__label">Volumes</span>
                <strong>{persistentVolumes.data.summary.totalVolumes}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Protected</span>
                <strong>{persistentVolumes.data.summary.protectedVolumes}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Needs attention</span>
                <strong>{persistentVolumes.data.summary.attentionVolumes}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Attached bytes</span>
                <strong>{formatBytes(persistentVolumes.data.summary.attachedBytes)}</strong>
              </div>
            </div>

            <div className="persistent-volume-list">
              {persistentVolumes.data.volumes.map((volume) => (
                <article
                  className="token-card"
                  data-testid={`persistent-volume-card-${volume.id}`}
                  key={volume.id}
                >
                  <div className="token-card__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {volume.environmentName} · {volume.projectName}
                      </p>
                      <h3>{volume.volumeName}</h3>
                    </div>
                    <span
                      className={`deployment-status deployment-status--${getPersistentVolumeTone(volume.backupCoverage, volume.restoreReadiness)}`}
                    >
                      {volume.backupCoverage}
                    </span>
                  </div>
                  <p className="deployment-card__meta">
                    {volume.serviceName} on {volume.targetServerName} ·{" "}
                    {formatBytes(volume.sizeBytes)}
                  </p>
                  <p className="deployment-card__meta">
                    Mount path: {volume.mountPath} · Driver: {volume.driver}
                  </p>
                  <p className="deployment-card__meta">
                    Backup policy: {volume.backupPolicyId ?? "Unmanaged"} · Restore readiness:{" "}
                    {volume.restoreReadiness}
                  </p>
                  <p className="deployment-card__meta">
                    Last backup: {volume.lastBackupAt ?? "No snapshot recorded"} · Last restore
                    test: {volume.lastRestoreTestAt ?? "Not exercised"}
                  </p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {persistentVolumesMessage ??
              "Sign in to inspect mounted volumes, backup coverage, and restore readiness."}
          </p>
        )}
      </section>

      <section className="compose-release-catalog">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Compose-first targets</p>
          <h2>Compose release catalog</h2>
        </div>

        {session.data && canQueueDeployments && composeReleaseCatalog.data ? (
          <form
            className="compose-release-composer"
            data-testid="compose-release-form"
            onSubmit={(event) => void handleQueueComposeRelease(event)}
          >
            <div>
              <p className="roadmap-item__lane">Typed release queue</p>
              <h3>Queue a compose release</h3>
              <p className="deployment-card__meta">
                Pick a seeded Compose target and queue a rollout with topology-aware steps.
              </p>
            </div>
            <label>
              Release target
              <select
                value={composeReleaseTargetId}
                onChange={(event) => setComposeReleaseTargetId(event.target.value)}
              >
                {composeReleaseCatalog.data.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.projectName} / {service.environmentName} / {service.serviceName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Commit SHA
              <input
                value={composeReleaseCommitSha}
                onChange={(event) => setComposeReleaseCommitSha(event.target.value)}
              />
            </label>
            <label>
              Image override
              <input
                value={composeReleaseImageTag}
                onChange={(event) => setComposeReleaseImageTag(event.target.value)}
                placeholder="optional override"
              />
            </label>
            <button
              className="action-button"
              disabled={composeReleaseMutationPending}
              type="submit"
            >
              {composeReleaseMutationPending ? "Queueing..." : "Queue compose release"}
            </button>
            {canRequestApprovals ? (
              <button
                className="action-button action-button--muted"
                disabled={approvalMutationPending}
                onClick={() => {
                  void handleRequestComposeReleaseApproval();
                }}
                type="button"
              >
                {approvalMutationPending ? "Requesting..." : "Request approval"}
              </button>
            ) : null}
            {composeReleaseFeedback ? (
              <p className="auth-feedback" data-testid="compose-release-feedback">
                {composeReleaseFeedback}
              </p>
            ) : null}
          </form>
        ) : session.data ? (
          <p className="viewer-empty">Deploy-capable roles can queue Compose releases here.</p>
        ) : null}

        {session.data && composeReleaseCatalog.data ? (
          <>
            <div className="compose-release-summary" data-testid="compose-release-summary">
              <div className="token-summary__item">
                <span className="metric__label">Services</span>
                <strong>{composeReleaseCatalog.data.summary.totalServices}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Stateful</span>
                <strong>{composeReleaseCatalog.data.summary.statefulServices}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Healthy envs</span>
                <strong>{composeReleaseCatalog.data.summary.healthyEnvironments}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Networks</span>
                <strong>{composeReleaseCatalog.data.summary.uniqueNetworks}</strong>
              </div>
            </div>

            <div className="compose-release-list">
              {composeReleaseCatalog.data.services.map((service) => (
                <article
                  className="token-card"
                  data-testid={`compose-service-card-${service.id}`}
                  key={service.id}
                >
                  <div className="token-card__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {service.environmentName} · {service.projectName}
                      </p>
                      <h3>{service.serviceName}</h3>
                    </div>
                    <span
                      className={`deployment-status deployment-status--${service.releaseTrack === "stable" ? "healthy" : "running"}`}
                    >
                      {service.releaseTrack}
                    </span>
                  </div>
                  <p className="deployment-card__meta">
                    {service.targetServerName} · {service.composeFilePath}
                  </p>
                  <p className="deployment-card__meta">
                    Image: {service.imageReference} · Replicas: {service.replicaCount}
                  </p>
                  <p className="deployment-card__meta">
                    Ports:{" "}
                    {service.exposedPorts.length > 0
                      ? service.exposedPorts.join(", ")
                      : "internal only"}
                  </p>
                  <p className="deployment-card__meta">
                    Dependencies:{" "}
                    {service.dependencies.length > 0 ? service.dependencies.join(", ") : "none"} ·
                    Network: {service.networkName}
                  </p>
                  <p className="deployment-card__meta">
                    Volumes: {service.volumeMounts.join(", ")} · Healthcheck:{" "}
                    {service.healthcheckPath ?? "process-level"}
                  </p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {composeReleaseCatalogMessage ??
              "Sign in to inspect Compose release targets and queue rollouts from catalogued topology."}
          </p>
        )}
      </section>

      <section className="compose-drift">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Planning API</p>
          <h2>Compose drift inspector</h2>
        </div>

        {session.data && composeDriftReport.data ? (
          <>
            <div className="compose-drift-summary" data-testid="compose-drift-summary">
              <div className="token-summary__item">
                <span className="metric__label">Services</span>
                <strong>{composeDriftReport.data.summary.totalServices}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Aligned</span>
                <strong>{composeDriftReport.data.summary.alignedServices}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Review required</span>
                <strong>{composeDriftReport.data.summary.reviewRequired}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Blocked</span>
                <strong>{composeDriftReport.data.summary.blockedServices}</strong>
              </div>
            </div>

            <div className="compose-drift-list">
              {composeDriftReport.data.reports.map((report) => (
                <article
                  className="token-card"
                  data-testid={`compose-drift-card-${report.composeServiceId}`}
                  key={report.composeServiceId}
                >
                  <div className="token-card__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {report.environmentName} · {report.projectName}
                      </p>
                      <h3>{report.serviceName}</h3>
                    </div>
                    <span
                      className={`deployment-status deployment-status--${getComposeDriftTone(report.status)}`}
                    >
                      {report.status}
                    </span>
                  </div>
                  <p className="deployment-card__meta">
                    {report.targetServerName} · {report.composeFilePath}
                  </p>
                  <p className="deployment-card__meta">{report.summary}</p>
                  <p className="deployment-card__meta">
                    Desired image: {report.desiredImageReference} · Actual image:{" "}
                    {report.actualImageReference}
                  </p>
                  <p className="deployment-card__meta">
                    Desired replicas: {report.desiredReplicaCount} · Actual replicas:{" "}
                    {report.actualReplicaCount} · Runtime: {report.actualContainerState}
                  </p>
                  {report.diffs.length > 0 ? (
                    <div className="token-card__chips">
                      {report.diffs.map((diff) => (
                        <span className="token-chip" key={diff.id}>
                          {diff.field}: {diff.desiredValue}
                          {" -> "}
                          {diff.actualValue}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="rollback-plan__columns">
                    <div>
                      <h4>Impact</h4>
                      <p className="deployment-card__meta">{report.impactSummary}</p>
                      {report.diffs.length > 0 ? (
                        <ul className="deployment-card__steps">
                          {report.diffs.map((diff) => (
                            <li key={`${diff.id}-impact`}>{diff.impact}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div>
                      <h4>Safe next actions</h4>
                      <ul className="deployment-card__steps">
                        {report.recommendedActions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {composeDriftMessage ??
              "Sign in to compare desired Compose specs against the last observed runtime state."}
          </p>
        )}
      </section>

      <section className="deployments">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Deployment write-path foundation</p>
          <h2>Queued and historical deployments</h2>
        </div>

        {session.data && canQueueDeployments ? (
          <form
            className="deployment-composer"
            data-testid="manual-deployment-form"
            onSubmit={(event) => void handleCreateDeployment(event)}
          >
            <div>
              <p className="roadmap-item__lane">Safe operator action</p>
              <h3>Queue a deployment record</h3>
              <p className="deployment-card__meta">
                This only creates immutable control-plane records and pending steps. Docker
                execution remains outside the web process.
              </p>
            </div>
            <label>
              Service name
              <input value={serviceName} onChange={(event) => setServiceName(event.target.value)} />
            </label>
            <label>
              Commit SHA
              <input value={commitSha} onChange={(event) => setCommitSha(event.target.value)} />
            </label>
            <label>
              Image tag
              <input value={imageTag} onChange={(event) => setImageTag(event.target.value)} />
            </label>
            <button
              className="action-button"
              disabled={createDeploymentRecord.isPending}
              type="submit"
            >
              {createDeploymentRecord.isPending ? "Queueing..." : "Queue deployment record"}
            </button>
            {deploymentFeedback ? (
              <p className="auth-feedback" data-testid="deployment-feedback">
                {deploymentFeedback}
              </p>
            ) : null}
          </form>
        ) : session.data ? (
          <p className="viewer-empty">
            Deploy-capable roles can queue immutable deployment records here.
          </p>
        ) : null}

        {session.data && recentDeployments.data ? (
          <div className="deployment-list">
            {recentDeployments.data.map((deployment) => (
              <article
                className="deployment-card"
                data-testid={`deployment-card-${deployment.id}`}
                key={deployment.id}
              >
                <div className="deployment-card__top">
                  <div>
                    <p className="roadmap-item__lane">{deployment.environmentName}</p>
                    <h3>{deployment.serviceName}</h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${deployment.status}`}
                    data-testid={`deployment-status-${deployment.id}`}
                  >
                    {deployment.status}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {deployment.projectName} on {deployment.targetServerName} (
                  {deployment.targetServerHost})
                </p>
                <p className="deployment-card__meta">
                  Source: {deployment.sourceType} · Commit: {deployment.commitSha} · Image:{" "}
                  {deployment.imageTag}
                </p>
                <p className="deployment-card__meta">Requested by {deployment.requestedByEmail}</p>
                {"steps" in deployment &&
                  Array.isArray((deployment as unknown as { steps: unknown }).steps) && (
                    <ul className="deployment-card__steps">
                      {(
                        deployment as unknown as {
                          steps: { id: number; label: string; detail: string | null }[];
                        }
                      ).steps.map((step) => (
                        <li key={step.id}>
                          <strong>{step.label}</strong>: {step.detail}
                        </li>
                      ))}
                    </ul>
                  )}
              </article>
            ))}
          </div>
        ) : (
          <p className="viewer-empty">
            {deploymentMessage ?? "Sign in to inspect deployment records and structured steps."}
          </p>
        )}
      </section>

      <section className="deployment-insights">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Agentic observability</p>
          <h2>Agent-ready deployment diagnostics</h2>
        </div>

        {session.data && deploymentInsights.data ? (
          <div className="insight-list">
            {deploymentInsights.data.map((insight) => (
              <article
                className="timeline-event"
                data-testid={`deployment-insight-${insight.deploymentId}`}
                key={insight.deploymentId}
              >
                <div className="timeline-event__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {insight.environmentName} · {insight.projectName}
                    </p>
                    <h3>{insight.serviceName}</h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${getInventoryTone(insight.status)}`}
                  >
                    {insight.status}
                  </span>
                </div>
                <p className="deployment-card__meta">{insight.summary}</p>
                <p className="deployment-card__meta">
                  Suspected root cause: {insight.suspectedRootCause}
                </p>
                {insight.healthyBaseline ? (
                  <p className="deployment-card__meta">
                    Healthy baseline: {insight.healthyBaseline.commitSha} ·{" "}
                    {insight.healthyBaseline.imageTag}
                  </p>
                ) : null}
                <div className="token-card__chips">
                  {insight.evidence.map((item) => (
                    <span className="token-chip" key={item.id}>
                      {item.kind}:{item.title}
                    </span>
                  ))}
                </div>
                <ul className="deployment-card__steps">
                  {insight.safeActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="viewer-empty">
            {insightsMessage ?? "Sign in to inspect evidence-backed deployment diagnostics."}
          </p>
        )}
      </section>

      <section className="rollback-plans">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Recovery planning</p>
          <h2>Rollback planning</h2>
        </div>

        {session.data && deploymentRollbackPlans.data ? (
          <div className="rollback-plan-list">
            {deploymentRollbackPlans.data.map((plan) => (
              <article
                className="deployment-card"
                data-testid={`rollback-plan-${plan.deploymentId}`}
                key={plan.deploymentId}
              >
                <div className="deployment-card__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {plan.environmentName} · {plan.projectName}
                    </p>
                    <h3>{plan.serviceName}</h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${plan.isAvailable ? "queued" : getInventoryTone(plan.currentStatus)}`}
                  >
                    {plan.isAvailable ? "planned" : plan.currentStatus}
                  </span>
                </div>
                <p className="deployment-card__meta">{plan.reason}</p>
                <p className="deployment-card__meta">Current status: {plan.currentStatus}</p>
                {plan.targetCommitSha ? (
                  <p className="deployment-card__meta">
                    Rollback target: {plan.targetCommitSha} · {plan.targetImageTag}
                  </p>
                ) : null}
                <div className="rollback-plan__columns">
                  <div>
                    <p className="roadmap-item__lane">Preflight checks</p>
                    <ul className="deployment-card__steps">
                      {plan.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="roadmap-item__lane">Recovery steps</p>
                    <ul className="deployment-card__steps">
                      {plan.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="viewer-empty">
            {rollbackPlansMessage ?? "Sign in to inspect rollback targets and recovery checks."}
          </p>
        )}
      </section>

      <section className="execution-handoff">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Execution-plane foundation</p>
          <h2>Worker handoff queue</h2>
        </div>

        {session.data && executionQueue.data ? (
          <>
            <div className="queue-summary" data-testid="queue-summary">
              <div className="token-summary__item">
                <span className="metric__label">Total jobs</span>
                <strong>{executionQueue.data.summary.totalJobs}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Pending</span>
                <strong>{executionQueue.data.summary.pendingJobs}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Completed</span>
                <strong>{executionQueue.data.summary.completedJobs}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Failed</span>
                <strong>{executionQueue.data.summary.failedJobs}</strong>
              </div>
            </div>

            {executionFeedback ? (
              <p className="auth-feedback" data-testid="execution-feedback">
                {executionFeedback}
              </p>
            ) : null}

            <div className="queue-list">
              {executionQueue.data.jobs.map((job) => (
                <article
                  className="token-card"
                  data-testid={`execution-job-${job.id}`}
                  key={job.id}
                >
                  <div className="token-card__top">
                    <div>
                      <p className="roadmap-item__lane">{job.environmentName}</p>
                      <h3>{job.serviceName}</h3>
                    </div>
                    <span
                      className={`deployment-status deployment-status--${getExecutionJobTone(job.status)}`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <p className="deployment-card__meta">
                    Queue: {job.queueName} · Worker hint: {job.workerHint}
                  </p>
                  <p className="deployment-card__meta">
                    {job.projectName} on {job.targetServerName} ({job.targetServerHost})
                  </p>
                  {canOperateExecutionJobs ? (
                    <div className="job-actions">
                      {job.status === "pending" ? (
                        <button
                          className="action-button"
                          disabled={executionMutationPending}
                          onClick={() => {
                            void handleDispatchJob(job.id, job.serviceName);
                          }}
                          type="button"
                        >
                          Dispatch
                        </button>
                      ) : null}
                      {job.status === "dispatched" ? (
                        <>
                          <button
                            className="action-button"
                            disabled={executionMutationPending}
                            onClick={() => {
                              void handleCompleteJob(job.id, job.serviceName);
                            }}
                            type="button"
                          >
                            Mark healthy
                          </button>
                          <button
                            className="action-button action-button--muted"
                            disabled={executionMutationPending}
                            onClick={() => {
                              void handleFailJob(job.id, job.serviceName);
                            }}
                            type="button"
                          >
                            Mark failed
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {executionQueueMessage ?? "Sign in to inspect queued worker handoff jobs."}
          </p>
        )}

        <div className="roadmap__header">
          <p className="roadmap__kicker">Immutable event feed</p>
          <h2>Operations timeline</h2>
        </div>

        {session.data && operationsTimeline.data ? (
          <div className="timeline-list">
            {operationsTimeline.data.map((event) => (
              <article
                className="timeline-event"
                data-testid={`timeline-event-${event.id}`}
                key={event.id}
              >
                <div className="timeline-event__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {event.resourceType} · {event.kind}
                    </p>
                    <h3>{event.summary}</h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${getTimelineTone(event.kind)}`}
                  >
                    {getTimelineLifecycle(event.kind)}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {event.serviceName} · {event.resourceId}
                </p>
                <p className="deployment-card__meta">{event.detail}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="viewer-empty">
            {timelineMessage ?? "Sign in to inspect immutable deployment events."}
          </p>
        )}
      </section>

      <section className="audit-trail">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Auditability before convenience</p>
          <h2>Immutable control-plane audit trail</h2>
        </div>

        {session.data && auditTrail.data ? (
          <>
            <div className="audit-summary" data-testid="audit-summary">
              <div className="token-summary__item">
                <span className="metric__label">Entries</span>
                <strong>{auditTrail.data.summary.totalEntries}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Deploy</span>
                <strong>{auditTrail.data.summary.deploymentActions}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Execution</span>
                <strong>{auditTrail.data.summary.executionActions}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Backup</span>
                <strong>{auditTrail.data.summary.backupActions}</strong>
              </div>
            </div>

            <div className="audit-list">
              {auditTrail.data.entries.map((entry) => (
                <article
                  className="timeline-event"
                  data-testid={`audit-entry-${entry.id}`}
                  key={entry.id}
                >
                  <div className="timeline-event__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {entry.actorLabel}
                        {entry.actorRole ? ` · ${entry.actorRole}` : ` · ${entry.actorType}`}
                      </p>
                      <h3>{entry.action}</h3>
                    </div>
                    <span
                      className={`deployment-status deployment-status--${getAuditTone(entry.action)}`}
                    >
                      {entry.resourceType}
                    </span>
                  </div>
                  <p className="deployment-card__meta">{entry.resourceLabel}</p>
                  <p className="deployment-card__meta">{entry.detail}</p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {auditMessage ?? "Sign in to inspect immutable control-plane audit entries."}
          </p>
        )}
      </section>

      <section className="deployment-logs">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Raw evidence</p>
          <h2>Append-only deployment logs</h2>
        </div>

        {session.data && deploymentLogs.data ? (
          <>
            <div className="log-summary" data-testid="log-summary">
              <div className="token-summary__item">
                <span className="metric__label">Lines</span>
                <strong>{deploymentLogs.data.summary.totalLines}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">stderr</span>
                <strong>{deploymentLogs.data.summary.stderrLines}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Deployments</span>
                <strong>{deploymentLogs.data.summary.deploymentCount}</strong>
              </div>
            </div>

            <div className="log-list">
              {deploymentLogs.data.lines.map((line) => (
                <article
                  className="token-card log-line"
                  data-testid={`deployment-log-line-${line.id}`}
                  key={line.id}
                >
                  <div className="token-card__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {line.serviceName} · {line.environmentName}
                      </p>
                      <h3>
                        {line.stream} #{line.lineNumber}
                      </h3>
                    </div>
                    <span
                      className={`deployment-status deployment-status--${getLogTone(line.stream)}`}
                    >
                      {line.stream}
                    </span>
                  </div>
                  <p className="deployment-card__meta log-line__message">{line.message}</p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {logsMessage ?? "Sign in to inspect append-only deployment log lines."}
          </p>
        )}
      </section>

      <BackupCatalog
        session={session}
        backupOverview={backupOverview}
        backupRestoreQueue={backupRestoreQueue}
        backupMessage={backupMessage}
        backupRestoreMessage={backupRestoreMessage}
        canOperateExecutionJobs={canOperateExecutionJobs}
        canRequestApprovals={canRequestApprovals}
        refreshOperationalViews={refreshOperationalViews}
        onApprovalFeedback={setApprovalFeedback}
      />

      <ApprovalQueue
        session={session}
        approvalQueue={approvalQueue}
        approvalMessage={approvalMessage}
        canOperateExecutionJobs={canOperateExecutionJobs}
        refreshOperationalViews={refreshOperationalViews}
        externalFeedback={approvalFeedback}
      />

      <section className="token-inventory">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Agent-safe API tokens</p>
          <h2>Scoped automation identities</h2>
        </div>

        {session.data && agentTokenInventory.data ? (
          <>
            <div className="token-summary" data-testid="token-summary">
              <div className="token-summary__item">
                <span className="metric__label">Total tokens</span>
                <strong>{agentTokenInventory.data.summary.totalTokens}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Read-only</span>
                <strong>{agentTokenInventory.data.summary.readOnlyTokens}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Planning</span>
                <strong>{agentTokenInventory.data.summary.planningTokens}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Command</span>
                <strong>{agentTokenInventory.data.summary.commandTokens}</strong>
              </div>
            </div>

            <div className="token-list">
              {agentTokenInventory.data.tokens.map((token) => (
                <article
                  className="token-card"
                  data-testid={`token-card-${token.id}`}
                  key={token.id}
                >
                  <div className="token-card__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {token.principalKind} · {token.principalRole}
                      </p>
                      <h3>{token.label}</h3>
                    </div>
                    <span
                      className={`deployment-status deployment-status--${token.status === "active" ? "healthy" : token.status === "paused" ? "running" : "failed"}`}
                    >
                      {token.status}
                    </span>
                  </div>
                  <p className="deployment-card__meta">
                    {token.principalName} · Prefix {token.tokenPrefix}
                  </p>
                  <p className="deployment-card__meta">
                    Lanes: {token.lanes.join(", ")} · Effective capabilities:{" "}
                    {token.effectiveCapabilities.length}
                  </p>
                  <div className="token-card__chips">
                    {token.scopes.map((scope) => (
                      <span className="token-chip" key={scope}>
                        {scope}
                      </span>
                    ))}
                  </div>
                  <p className="deployment-card__meta">
                    Withheld from role by token narrowing: {token.withheldCapabilities.length}
                  </p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {tokenMessage ?? "Elevated roles can inspect scoped automation identities here."}
          </p>
        )}
      </section>

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
