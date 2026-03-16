import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Rocket } from "lucide-react";

export default function DeploymentsPage() {
  const session = useSession();
  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    { enabled: Boolean(session.data) }
  );

  const deployments = recentDeployments.data ?? [];

  return (
    <main className="shell">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Deployments</h1>
          <p className="page-header__desc">
            View deployment history and status across all services.
          </p>
        </div>
      </div>

      {!session.data ? (
        <div className="empty-state">
          <p>Sign in to view deployments.</p>
        </div>
      ) : recentDeployments.isLoading ? (
        <div className="skeleton" style={{ height: "12rem" }} />
      ) : deployments.length === 0 ? (
        <div className="empty-state">
          <Rocket size={32} />
          <p>No deployments yet. Queue your first deployment to get started.</p>
        </div>
      ) : (
        <div className="deploy-table-wrap">
          <table className="deploy-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Source</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={String(d.id)}>
                  <td className="deploy-table__service">
                    {String(d.serviceName ?? d.projectId ?? "—")}
                  </td>
                  <td>
                    <span
                      className={`badge badge--${d.status === "healthy" ? "green" : d.status === "failed" ? "red" : d.status === "running" ? "blue" : "amber"}`}
                    >
                      {String(d.status)}
                    </span>
                  </td>
                  <td className="deploy-table__type">{String(d.sourceType ?? "docker")}</td>
                  <td className="deploy-table__time">
                    {d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
