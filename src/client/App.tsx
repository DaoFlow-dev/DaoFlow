import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { signIn, signOut, signUp, useSession } from "./lib/auth-client";
import { trpc } from "./lib/trpc";
import { StatusCard } from "./components/status-card";

type StatusTone = "healthy" | "failed" | "running" | "queued";

function getInventoryTone(status: string): StatusTone {
  if (status === "healthy") {
    return "healthy";
  }

  if (status === "failed" || status === "offline") {
    return "failed";
  }

  if (status === "running" || status === "degraded") {
    return "running";
  }

  return "queued";
}

function getExecutionJobTone(status: string): StatusTone {
  if (status === "completed") {
    return "healthy";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "pending") {
    return "queued";
  }

  return "running";
}

function getTimelineLifecycle(kind: string) {
  if (kind === "deployment.failed" || kind === "execution.job.failed" || kind === "step.failed") {
    return "failed" as const;
  }

  if (
    kind === "deployment.succeeded" ||
    kind === "execution.job.completed" ||
    kind === "step.completed"
  ) {
    return "completed" as const;
  }

  if (kind === "execution.job.dispatched" || kind === "step.running") {
    return "running" as const;
  }

  return "queued" as const;
}

function getTimelineTone(kind: string): StatusTone {
  const lifecycle = getTimelineLifecycle(kind);

  if (lifecycle === "failed") {
    return "failed";
  }

  if (lifecycle === "completed") {
    return "healthy";
  }

  return "queued";
}

function getAuditTone(action: string): StatusTone {
  if (action === "execution.complete") {
    return "healthy";
  }

  if (action === "execution.fail") {
    return "failed";
  }

  if (action === "execution.dispatch") {
    return "running";
  }

  return "queued";
}

export default function App() {
  const session = useSession();
  const health = trpc.health.useQuery();
  const overview = trpc.platformOverview.useQuery();
  const roadmap = trpc.roadmap.useQuery({});
  const createDeploymentRecord = trpc.createDeploymentRecord.useMutation();
  const triggerBackupRun = trpc.triggerBackupRun.useMutation();
  const dispatchExecutionJob = trpc.dispatchExecutionJob.useMutation();
  const completeExecutionJob = trpc.completeExecutionJob.useMutation();
  const failExecutionJob = trpc.failExecutionJob.useMutation();
  const recentDeployments = trpc.recentDeployments.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const backupOverview = trpc.backupOverview.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const executionQueue = trpc.executionQueue.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const operationsTimeline = trpc.operationsTimeline.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const infrastructureInventory = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const deploymentInsights = trpc.deploymentInsights.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const auditTrail = trpc.auditTrail.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const viewer = trpc.viewer.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const adminControlPlane = trpc.adminControlPlane.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const currentRole = viewer.data?.authz.role ?? "guest";
  const canViewAgentTokenInventory = currentRole === "owner" || currentRole === "admin";
  const agentTokenInventory = trpc.agentTokenInventory.useQuery(undefined, {
    enabled: canViewAgentTokenInventory
  });
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [name, setName] = useState("DaoFlow Operator");
  const [email, setEmail] = useState("operator@daoflow.local");
  const [password, setPassword] = useState("secret1234");
  const [serviceName, setServiceName] = useState("edge-worker");
  const [commitSha, setCommitSha] = useState("abcdef1");
  const [imageTag, setImageTag] = useState("ghcr.io/daoflow/edge-worker:0.2.0");
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);
  const [deploymentFeedback, setDeploymentFeedback] = useState<string | null>(null);
  const [executionFeedback, setExecutionFeedback] = useState<string | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthFeedback(null);

    const result = await signUp.email({
      name,
      email,
      password
    });

    if (result.error) {
      setAuthFeedback(result.error.message ?? "Sign-up failed.");
      return;
    }

    await session.refetch();
    const viewerResponse = await viewer.refetch();
    await adminControlPlane.refetch();
    const nextRole = viewerResponse.data?.authz.role;

    if (nextRole === "owner" || nextRole === "admin") {
      await agentTokenInventory.refetch();
    }
    setAuthFeedback("Account created and session established.");
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthFeedback(null);

    const result = await signIn.email({
      email,
      password
    });

    if (result.error) {
      setAuthFeedback(result.error.message ?? "Sign-in failed.");
      return;
    }

    await session.refetch();
    const viewerResponse = await viewer.refetch();
    await adminControlPlane.refetch();
    const nextRole = viewerResponse.data?.authz.role;

    if (nextRole === "owner" || nextRole === "admin") {
      await agentTokenInventory.refetch();
    }
    setAuthFeedback("Signed in successfully.");
  }

  async function handleSignOut() {
    await signOut();
    await session.refetch();
    setAuthFeedback("Signed out.");
    setDeploymentFeedback(null);
    setExecutionFeedback(null);
    setBackupFeedback(null);
  }

  async function refreshOperationalViews() {
    await recentDeployments.refetch();
    await deploymentInsights.refetch();
    await auditTrail.refetch();
    await backupOverview.refetch();
    await executionQueue.refetch();
    await operationsTimeline.refetch();
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
        isTRPCClientError(error)
          ? error.message
          : "Unable to dispatch the execution job right now."
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
        isTRPCClientError(error)
          ? error.message
          : "Unable to complete the execution job right now."
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
        isTRPCClientError(error)
          ? error.message
          : "Unable to fail the execution job right now."
      );
    }
  }

  async function handleTriggerBackupRun(policyId: string, service: string) {
    setBackupFeedback(null);

    try {
      await triggerBackupRun.mutateAsync({
        policyId
      });
      await refreshOperationalViews();
      setBackupFeedback(`Queued backup run for ${service}.`);
    } catch (error) {
      setBackupFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to queue the backup run right now."
      );
    }
  }

  const viewerMessage =
    viewer.error && isTRPCClientError(viewer.error)
      ? viewer.error.message
      : null;
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
  const insightsMessage =
    deploymentInsights.error && isTRPCClientError(deploymentInsights.error)
      ? deploymentInsights.error.message
      : null;
  const auditMessage =
    auditTrail.error && isTRPCClientError(auditTrail.error)
      ? auditTrail.error.message
      : null;
  const tokenMessage =
    agentTokenInventory.error && isTRPCClientError(agentTokenInventory.error)
      ? agentTokenInventory.error.message
      : null;
  const canQueueDeployments =
    currentRole === "owner" ||
    currentRole === "admin" ||
    currentRole === "operator" ||
    currentRole === "developer";
  const canOperateExecutionJobs =
    currentRole === "owner" || currentRole === "admin" || currentRole === "operator";
  const executionMutationPending =
    dispatchExecutionJob.isPending ||
    completeExecutionJob.isPending ||
    failExecutionJob.isPending;
  const backupMutationPending = triggerBackupRun.isPending;

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero__copy">
          <p className="hero__kicker">Docker-first control plane</p>
          <h1>DaoFlow</h1>
          <p className="hero__lede">
            A typed control plane for Docker and Compose deployments with agent-safe
            automation boundaries.
          </p>
        </div>

        <div className="hero__rail">
          <div className="metric metric--auth">
            <span className="metric__label">Session</span>
            <span className="metric__value" data-testid="session-state">
              {session.isPending
                ? "checking"
                : session.data
                  ? "signed in"
                  : "signed out"}
            </span>
            {session.data ? (
              <p className="metric__detail" data-testid="session-email">
                {session.data.user.email}
              </p>
            ) : (
              <p className="metric__detail">Use Better Auth to unlock protected tRPC data.</p>
            )}
          </div>
          <div className="metric">
            <span className="metric__label">Service health</span>
            <span className="metric__value">
              {health.data?.status ?? "checking"}
            </span>
          </div>
          <div className="metric">
            <span className="metric__label">Current slice</span>
            <span className="metric__value">
              {overview.data?.currentSlice ?? "loading"}
            </span>
          </div>
          <div className="metric">
            <span className="metric__label">Role</span>
            <span className="metric__value" data-testid="role-state">
              {currentRole}
            </span>
            <p className="metric__detail">
              {viewer.data
                ? `${viewer.data.authz.capabilities.length} granted capability lanes`
                : "Role-aware policies unlock after sign-in."}
            </p>
          </div>
        </div>
      </section>

      <section className="auth-section">
        <div className="auth-panel">
          <div className="auth-panel__header">
            <div>
              <p className="roadmap__kicker">Auth slice</p>
              <h2>Better Auth + protected tRPC</h2>
            </div>
            <div className="auth-panel__switches">
              <button
                className={authMode === "sign-up" ? "tab tab--active" : "tab"}
                onClick={() => setAuthMode("sign-up")}
                type="button"
              >
                Sign up
              </button>
              <button
                className={authMode === "sign-in" ? "tab tab--active" : "tab"}
                onClick={() => setAuthMode("sign-in")}
                type="button"
              >
                Sign in
              </button>
            </div>
          </div>

          {!session.data ? (
            <form
              className="auth-form"
              onSubmit={(event) => {
                void (authMode === "sign-up" ? handleSignUp(event) : handleSignIn(event));
              }}
            >
              {authMode === "sign-up" ? (
                <label>
                  Name
                  <input value={name} onChange={(event) => setName(event.target.value)} />
                </label>
              ) : null}

              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              <button className="action-button" type="submit">
                {authMode === "sign-up" ? "Create account" : "Sign in"}
              </button>
            </form>
          ) : (
            <div className="auth-state">
              <p className="auth-state__summary" data-testid="auth-summary">
                Signed in as <strong>{session.data.user.email}</strong>.
              </p>
              <p className="auth-state__role" data-testid="auth-role">
                Assigned role: <strong>{currentRole}</strong>
              </p>
              <button
                className="action-button action-button--muted"
                onClick={() => {
                  void handleSignOut();
                }}
                type="button"
              >
                Sign out
              </button>
            </div>
          )}

          {authFeedback ? <p className="auth-feedback">{authFeedback}</p> : null}
        </div>

        <div className="auth-panel auth-panel--viewer">
          <p className="roadmap__kicker">Protected procedure</p>
          <h2>Viewer</h2>
          {session.data && viewer.data ? (
            <pre className="viewer-output" data-testid="viewer-output">
              {JSON.stringify(viewer.data, null, 2)}
            </pre>
          ) : (
            <p className="viewer-empty">
              {viewerMessage ?? "Sign in to fetch the protected viewer procedure."}
            </p>
          )}
        </div>

        <div className="auth-panel auth-panel--viewer">
          <p className="roadmap__kicker">Role-gated procedure</p>
          <h2>Admin control plane</h2>
          {session.data && adminControlPlane.data ? (
            <pre className="viewer-output" data-testid="admin-output">
              {JSON.stringify(adminControlPlane.data, null, 2)}
            </pre>
          ) : (
            <p className="viewer-empty">
              {adminMessage ?? "Elevated roles can inspect governance guardrails here."}
            </p>
          )}
        </div>
      </section>

      <section className="grid">
        <StatusCard
          title="Control plane"
          items={overview.data?.architecture.controlPlane ?? []}
        />
        <StatusCard
          title="Execution plane"
          items={overview.data?.architecture.executionPlane ?? []}
        />
        <StatusCard
          title="Agent API lanes"
          items={overview.data?.guardrails.agentApiLanes ?? []}
        />
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
            {infrastructureMessage ?? "Sign in to inspect managed servers, projects, and environments."}
          </p>
        )}
      </section>

      <section className="deployments">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Deployment write-path foundation</p>
          <h2>Queued and historical deployments</h2>
        </div>

        {session.data && canQueueDeployments ? (
          <form className="deployment-composer" onSubmit={(event) => void handleCreateDeployment(event)}>
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
              <input
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
              />
            </label>
            <label>
              Commit SHA
              <input value={commitSha} onChange={(event) => setCommitSha(event.target.value)} />
            </label>
            <label>
              Image tag
              <input value={imageTag} onChange={(event) => setImageTag(event.target.value)} />
            </label>
            <button className="action-button" disabled={createDeploymentRecord.isPending} type="submit">
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
                  {deployment.projectName} on {deployment.targetServerName} ({deployment.targetServerHost})
                </p>
                <p className="deployment-card__meta">
                  Source: {deployment.sourceType} · Commit: {deployment.commitSha} · Image:{" "}
                  {deployment.imageTag}
                </p>
                <p className="deployment-card__meta">
                  Requested by {deployment.requestedByEmail}
                </p>
                <ul className="deployment-card__steps">
                  {deployment.steps.map((step) => (
                    <li key={step.id}>
                      <strong>{step.label}</strong>: {step.detail}
                    </li>
                  ))}
                </ul>
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
              <article className="timeline-event" data-testid={`timeline-event-${event.id}`} key={event.id}>
                <div className="timeline-event__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {event.environmentName} · {event.kind}
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
                  {event.serviceName} · {event.actorLabel}
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

      <section className="backup-catalog">
        <div className="roadmap__header">
          <p className="roadmap__kicker">Backup awareness</p>
          <h2>Backup policies and runs</h2>
        </div>

        {session.data && backupOverview.data ? (
          <>
            <div className="backup-summary" data-testid="backup-summary">
              <div className="token-summary__item">
                <span className="metric__label">Policies</span>
                <strong>{backupOverview.data.summary.totalPolicies}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Queued</span>
                <strong>{backupOverview.data.summary.queuedRuns}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Succeeded</span>
                <strong>{backupOverview.data.summary.succeededRuns}</strong>
              </div>
              <div className="token-summary__item">
                <span className="metric__label">Failed</span>
                <strong>{backupOverview.data.summary.failedRuns}</strong>
              </div>
            </div>

            {backupFeedback ? (
              <p className="auth-feedback" data-testid="backup-feedback">
                {backupFeedback}
              </p>
            ) : null}

            <div className="backup-policy-list">
              {backupOverview.data.policies.map((policy) => (
                <article
                  className="token-card"
                  data-testid={`backup-policy-${policy.id}`}
                  key={policy.id}
                >
                  <div className="token-card__top">
                    <div>
                      <p className="roadmap-item__lane">{policy.environmentName}</p>
                      <h3>{policy.serviceName}</h3>
                    </div>
                    <span className="deployment-status deployment-status--queued">
                      {policy.targetType}
                    </span>
                  </div>
                  <p className="deployment-card__meta">
                    {policy.storageProvider} · {policy.scheduleLabel}
                  </p>
                  <p className="deployment-card__meta">
                    Retention: {policy.retentionCount} snapshots
                  </p>
                  {canOperateExecutionJobs ? (
                    <div className="job-actions">
                      <button
                        className="action-button"
                        disabled={backupMutationPending}
                        onClick={() => {
                          void handleTriggerBackupRun(policy.id, policy.serviceName);
                        }}
                        type="button"
                      >
                        Queue backup
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>

            <div className="backup-run-list">
              {backupOverview.data.runs.map((run) => (
                <article className="timeline-event" data-testid={`backup-run-${run.id}`} key={run.id}>
                  <div className="timeline-event__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {run.environmentName} · {run.triggerKind}
                      </p>
                      <h3>{run.serviceName}</h3>
                    </div>
                    <span
                      className={`deployment-status deployment-status--${run.status === "succeeded" ? "healthy" : run.status === "failed" ? "failed" : run.status === "running" ? "running" : "queued"}`}
                    >
                      {run.status}
                    </span>
                  </div>
                  <p className="deployment-card__meta">
                    {run.targetType} backup · Requested by {run.requestedBy}
                  </p>
                  <p className="deployment-card__meta">
                    {run.artifactPath ?? "Artifact path will be assigned by the future backup worker."}
                  </p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="viewer-empty">
            {backupMessage ?? "Sign in to inspect backup policies and recent runs."}
          </p>
        )}
      </section>

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
