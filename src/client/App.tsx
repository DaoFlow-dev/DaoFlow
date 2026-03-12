import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { signIn, signOut, signUp, useSession } from "./lib/auth-client";
import { trpc } from "./lib/trpc";
import { StatusCard } from "./components/status-card";

type StatusTone = "healthy" | "failed" | "running" | "queued";

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

export default function App() {
  const session = useSession();
  const health = trpc.health.useQuery();
  const overview = trpc.platformOverview.useQuery();
  const roadmap = trpc.roadmap.useQuery({});
  const createDeploymentRecord = trpc.createDeploymentRecord.useMutation();
  const dispatchExecutionJob = trpc.dispatchExecutionJob.useMutation();
  const completeExecutionJob = trpc.completeExecutionJob.useMutation();
  const failExecutionJob = trpc.failExecutionJob.useMutation();
  const recentDeployments = trpc.recentDeployments.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const executionQueue = trpc.executionQueue.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const operationsTimeline = trpc.operationsTimeline.useQuery({}, {
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
  }

  async function refreshOperationalViews() {
    await recentDeployments.refetch();
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
  const executionQueueMessage =
    executionQueue.error && isTRPCClientError(executionQueue.error)
      ? executionQueue.error.message
      : null;
  const timelineMessage =
    operationsTimeline.error && isTRPCClientError(operationsTimeline.error)
      ? operationsTimeline.error.message
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
