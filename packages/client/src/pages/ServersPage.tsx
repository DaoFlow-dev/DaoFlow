import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";

export default function ServersPage() {
  const session = useSession();
  const serverReadiness = trpc.serverReadiness.useQuery({}, {
    enabled: Boolean(session.data),
  });

  const data = serverReadiness.data;
  const checks = data && !Array.isArray(data) ? data.checks : [];

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero__topbar">
          <div className="hero__brand">
            <p className="hero__kicker">Infrastructure</p>
            <h1>Servers</h1>
          </div>
          <p className="hero__lede">
            Manage your Docker host servers and connectivity.
          </p>
        </div>
      </section>

      <section style={{ marginTop: "1rem" }}>
        {!session.data ? (
          <p style={{ color: "#7a8194" }}>Sign in to view servers.</p>
        ) : serverReadiness.isLoading ? (
          <div className="skeleton" style={{ height: "6rem" }} />
        ) : checks.length === 0 ? (
          <div className="auth-panel" style={{ textAlign: "center", padding: "2rem" }}>
            <p style={{ color: "#7a8194", margin: 0 }}>No servers registered. Add your first server to get started.</p>
          </div>
        ) : (
          <div className="deployment-list">
            {checks.map((s) => (
              <article className="deployment-card" key={s.serverId}>
                <div className="deployment-card__top">
                  <h3>{s.serverName}</h3>
                  <span className={`deployment-status deployment-status--${s.readinessStatus === "ready" ? "healthy" : "queued"}`}>
                    {s.readinessStatus}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {s.serverHost}:{s.sshPort} · {s.targetKind}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
