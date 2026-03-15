import { canAssumeAnyRole, normalizeAppRole, type AppRole } from "@daoflow/shared";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { TokenInventory } from "../features/admin/TokenInventory";
import { isTRPCClientError } from "@trpc/client";

export default function SettingsPage() {
  const session = useSession();
  const enabled = Boolean(session.data);
  const viewer = trpc.viewer.useQuery(undefined, { enabled });
  const currentRole = viewer.data ? normalizeAppRole(viewer.data.authz.role) : "guest";
  const canViewTokens = canAssumeAnyRole(currentRole as AppRole, ["owner", "admin"]);
  const agentTokenInventory = trpc.agentTokenInventory.useQuery(undefined, {
    enabled: canViewTokens,
  });

  const errorMessage = (query: { error: unknown }) =>
    query.error && isTRPCClientError(query.error) ? query.error.message : null;

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero__topbar">
          <div className="hero__brand">
            <p className="hero__kicker">Administration</p>
            <h1>Settings</h1>
          </div>
          <p className="hero__lede">
            Manage tokens, roles, and platform configuration.
          </p>
        </div>
      </section>

      <section style={{ marginTop: "1rem" }}>
        {!session.data ? (
          <p style={{ color: "#7a8194" }}>Sign in to access settings.</p>
        ) : (
          <>
            <div className="auth-panel" style={{ marginBottom: "1rem" }}>
              <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.15rem", color: "#f0f2f5" }}>Account</h2>
              <p style={{ color: "#7a8194", fontSize: "0.88rem", margin: 0 }}>
                Signed in as <strong style={{ color: "#e1e4ea" }}>{session.data.user.email}</strong> · Role: <strong style={{ color: "#e1e4ea" }}>{currentRole}</strong>
              </p>
            </div>

            {canViewTokens && (
              <TokenInventory
                session={session}
                agentTokenInventory={agentTokenInventory}
                tokenMessage={errorMessage(agentTokenInventory)}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}
