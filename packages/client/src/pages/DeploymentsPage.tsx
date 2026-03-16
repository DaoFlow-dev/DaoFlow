import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";

export default function DeploymentsPage() {
  const session = useSession();
  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    {
      enabled: Boolean(session.data)
    }
  );

  const items = recentDeployments.data ?? [];

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero__topbar">
          <div className="hero__brand">
            <p className="hero__kicker">Deployment history</p>
            <h1>Deployments</h1>
          </div>
          <p className="hero__lede">Track deployment history, logs, and rollback targets.</p>
        </div>
      </section>

      <section style={{ marginTop: "1rem" }}>
        {!session.data ? (
          <p style={{ color: "#7a8194" }}>Sign in to view deployments.</p>
        ) : recentDeployments.isLoading ? (
          <div className="skeleton" style={{ height: "6rem" }} />
        ) : items.length === 0 ? (
          <div className="auth-panel" style={{ textAlign: "center", padding: "2rem" }}>
            <p style={{ color: "#7a8194", margin: 0 }}>
              No deployments yet. Queue a deployment to get started.
            </p>
          </div>
        ) : (
          <div className="deployment-list">
            {items.map((d) => (
              <article className="deployment-card" key={d.id}>
                <div className="deployment-card__top">
                  <h3>{d.serviceName}</h3>
                  <span className={`deployment-status deployment-status--${d.status}`}>
                    {d.status}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {d.sourceType} · {d.commitSha?.slice(0, 7) ?? "—"} ·{" "}
                  {new Date(d.createdAt).toLocaleString()}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
