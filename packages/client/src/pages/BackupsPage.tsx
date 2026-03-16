/* eslint-disable @typescript-eslint/no-base-to-string */
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { DatabaseBackup, Plus } from "lucide-react";

export default function BackupsPage() {
  const session = useSession();
  const backupOverview = trpc.backupOverview.useQuery({}, { enabled: Boolean(session.data) });

  const policies = backupOverview.data?.policies ?? [];
  const runs = backupOverview.data?.runs ?? [];

  return (
    <main className="shell">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Backups</h1>
          <p className="page-header__desc">
            Manage backup policies, view run history, and restore data.
          </p>
        </div>
        <button className="action-button" disabled>
          <Plus size={16} /> New Policy
        </button>
      </div>

      {!session.data ? (
        <div className="empty-state">
          <p>Sign in to view backups.</p>
        </div>
      ) : backupOverview.isLoading ? (
        <div className="skeleton" style={{ height: "12rem" }} />
      ) : policies.length === 0 && runs.length === 0 ? (
        <div className="empty-state">
          <DatabaseBackup size={32} />
          <p>No backup policies configured. Create a policy to start backing up your data.</p>
        </div>
      ) : (
        <>
          {/* Policies */}
          {policies.length > 0 && (
            <section className="dash-section">
              <h2 className="dash-section__title">Backup Policies</h2>
              <div className="server-grid">
                {policies.map((p) => (
                  <div className="server-card" key={String(p.id)}>
                    <div className="server-card__top">
                      <span className="server-card__name">{String(p.serviceName)}</span>
                      <span className="badge badge--green">{String(p.targetType)}</span>
                    </div>
                    <p className="server-card__detail">
                      Schedule: {String(p.scheduleLabel ?? "manual")} · Storage:{" "}
                      {String(p.storageProvider)}
                    </p>
                    <p className="server-card__detail">
                      Retention: {p.retentionCount} backups · Last run:{" "}
                      {p.lastRunAt ? new Date(p.lastRunAt).toLocaleDateString() : "never"}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent Runs */}
          {runs.length > 0 && (
            <section className="dash-section">
              <h2 className="dash-section__title">Recent Runs</h2>
              <div className="deploy-table-wrap">
                <table className="deploy-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Status</th>
                      <th>Trigger</th>
                      <th>Finished</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={String(r.id)}>
                        <td className="deploy-table__service">
                          {String(r.serviceName ?? r.policyId)}
                        </td>
                        <td>
                          <span
                            className={`badge badge--${r.status === "completed" || r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : "amber"}`}
                          >
                            {String(r.status)}
                          </span>
                        </td>
                        <td className="deploy-table__type">{String(r.triggerKind)}</td>
                        <td className="deploy-table__time">
                          {r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
