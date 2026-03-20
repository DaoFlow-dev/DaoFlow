import { useState } from "react";
import type { FormEvent } from "react";
import { signIn, signOut, signUp } from "@/lib/auth-client";

interface SessionData {
  user: { email: string; name: string };
}

interface ViewerData {
  authz: { role: string; capabilities: readonly string[] };
}

export interface AuthSectionProps {
  session: { data: SessionData | null; refetch: () => Promise<unknown> };
  viewer: { data?: ViewerData | null; refetch: () => Promise<{ data?: ViewerData | null }> };
  adminControlPlane: {
    data?: unknown;
    error?: unknown;
    refetch: () => Promise<unknown>;
  };
  agentTokenInventory: { refetch: () => Promise<unknown> };
  currentRole: string;
  viewerMessage: string | null;
  adminMessage: string | null;
  onSignOut: () => void;
}

export function AuthSection({
  session,
  viewer,
  adminControlPlane,
  agentTokenInventory,
  currentRole,
  viewerMessage,
  adminMessage,
  onSignOut
}: AuthSectionProps) {
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
    onSignOut();
  }

  return (
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
  );
}
