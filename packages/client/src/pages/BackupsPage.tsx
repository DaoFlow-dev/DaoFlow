import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";

export default function BackupsPage() {
  const session = useSession();
  const enabled = Boolean(session.data);
  const backupOverview = trpc.backupOverview.useQuery({}, { enabled });
  const backupRestoreQueue = trpc.backupRestoreQueue.useQuery({}, { enabled });

  const overviewData = backupOverview.data;
  const policies = overviewData && !Array.isArray(overviewData) ? overviewData.policies : [];
  const runs = overviewData && !Array.isArray(overviewData) ? overviewData.runs : [];
  const restoreData = backupRestoreQueue.data;
  const restoreRequests = restoreData && !Array.isArray(restoreData) ? restoreData.requests : [];

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero__topbar">
          <div className="hero__brand">
            <p className="hero__kicker">Data protection</p>
            <h1>Backups</h1>
          </div>
          <p className="hero__lede">
            Manage backup policies, runs, and restore operations.
          </p>
        </div>
      </section>

      <section style={{ marginTop: "1rem" }}>
        {!session.data ? (
          <p style={{ color: "#7a8194" }}>Sign in to view backups.</p>
        ) : backupOverview.isLoading ? (
          <div className="skeleton" style={{ height: "6rem" }} />
        ) : (
          <>
            <h2 style={{ fontSize: "1.15rem", color: "#f0f2f5", marginBottom: "0.75rem" }}>
              Backup Policies ({policies.length})
            </h2>
            {policies.length === 0 ? (
              <div className="auth-panel" style={{ textAlign: "center", padding: "2rem" }}>
                <p style={{ color: "#7a8194", margin: 0 }}>No backup policies configured.</p>
              </div>
            ) : (
              <div className="deployment-list">
                {policies.map((p) => (
                  <article className="deployment-card" key={p.id}>
                    <h3>{p.projectName} — {p.serviceName}</h3>
                    <p className="deployment-card__meta">
                      Retention: {p.retentionCount} · Schedule: {p.scheduleLabel ?? "manual"}
                    </p>
                  </article>
                ))}
              </div>
            )}

            <h2 style={{ fontSize: "1.15rem", color: "#f0f2f5", margin: "1.5rem 0 0.75rem" }}>
              Recent Runs ({runs.length})
            </h2>
            {runs.length === 0 ? (
              <p style={{ color: "#7a8194" }}>No backup runs recorded.</p>
            ) : (
              <div className="deployment-list">
                {runs.map((r) => (
                  <article className="deployment-card" key={r.id}>
                    <div className="deployment-card__top">
                      <h3>Run {r.id.slice(0, 8)}</h3>
                      <span className={`deployment-status deployment-status--${r.status === "succeeded" ? "healthy" : r.status === "failed" ? "failed" : "running"}`}>
                        {r.status}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <h2 style={{ fontSize: "1.15rem", color: "#f0f2f5", margin: "1.5rem 0 0.75rem" }}>
              Restore Queue ({restoreRequests.length})
            </h2>
            {restoreRequests.length === 0 ? (
              <p style={{ color: "#7a8194" }}>No pending restores.</p>
            ) : (
              <div className="deployment-list">
                {restoreRequests.map((r) => (
                  <article className="deployment-card" key={r.id}>
                    <div className="deployment-card__top">
                      <h3>Restore {r.id.slice(0, 8)}</h3>
                      <span className={`deployment-status deployment-status--${r.status === "completed" ? "healthy" : "running"}`}>
                        {r.status}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
