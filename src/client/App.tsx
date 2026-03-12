import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { signIn, signOut, signUp, useSession } from "./lib/auth-client";
import { trpc } from "./lib/trpc";
import { StatusCard } from "./components/status-card";

export default function App() {
  const session = useSession();
  const health = trpc.health.useQuery();
  const overview = trpc.platformOverview.useQuery();
  const roadmap = trpc.roadmap.useQuery({});
  const recentDeployments = trpc.recentDeployments.useQuery({}, {
    enabled: Boolean(session.data)
  });
  const viewer = trpc.viewer.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const adminControlPlane = trpc.adminControlPlane.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [name, setName] = useState("DaoFlow Operator");
  const [email, setEmail] = useState("operator@daoflow.local");
  const [password, setPassword] = useState("secret1234");
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);

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
    await viewer.refetch();
    await adminControlPlane.refetch();
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
    await viewer.refetch();
    await adminControlPlane.refetch();
    setAuthFeedback("Signed in successfully.");
  }

  async function handleSignOut() {
    await signOut();
    await session.refetch();
    setAuthFeedback("Signed out.");
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
  const currentRole = viewer.data?.authz.role ?? "guest";

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
          <p className="roadmap__kicker">Typed deployment records</p>
          <h2>Recent deployments</h2>
        </div>

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
