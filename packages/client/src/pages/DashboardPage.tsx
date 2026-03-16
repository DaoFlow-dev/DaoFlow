import { isTRPCClientError } from "@trpc/client";
import { canAssumeAnyRole, normalizeAppRole, type AppRole } from "@daoflow/shared";
import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";
import { AuthSection } from "../features/auth/AuthSection";
import {
  Server,
  FolderKanban,
  Rocket,
  Layers,
  CheckCircle2,
  XCircle,
  Clock,
  Activity
} from "lucide-react";

export default function DashboardPage() {
  const session = useSession();
  const health = trpc.health.useQuery();
  const overview = trpc.platformOverview.useQuery();

  const enabled = Boolean(session.data);
  const recentDeployments = trpc.recentDeployments.useQuery({ limit: 8 }, { enabled });
  const infrastructureInventory = trpc.infrastructureInventory.useQuery(undefined, { enabled });
  const serverReadiness = trpc.serverReadiness.useQuery({}, { enabled });

  const viewer = trpc.viewer.useQuery(undefined, { enabled });
  const adminControlPlane = trpc.adminControlPlane.useQuery(undefined, { enabled });
  const currentRole = viewer.data ? normalizeAppRole(viewer.data.authz.role) : "guest";
  const canViewAgentTokenInventory = canAssumeAnyRole(currentRole as AppRole, ["owner", "admin"]);
  const agentTokenInventory = trpc.agentTokenInventory.useQuery(undefined, {
    enabled: canViewAgentTokenInventory
  });

  const errorMessage = (query: { error: unknown }) =>
    query.error && isTRPCClientError(query.error) ? query.error.message : null;

  const infra = infrastructureInventory.data;
  const servers = infra?.servers ?? [];
  const projects = infra?.projects ?? [];
  const deployments = recentDeployments.data ?? [];
  const serverChecks = serverReadiness.data?.checks ?? [];

  return (
    <main className="shell">
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title" data-testid="main-heading">
            Dashboard
          </h1>
          <p className="page-header__desc">
            {health.data?.status === "healthy"
              ? "All systems operational"
              : "Checking system status…"}
          </p>
        </div>
      </div>

      {/* ── Auth (sign-in / sign-up) ── */}
      <AuthSection
        session={session}
        viewer={viewer}
        adminControlPlane={adminControlPlane}
        agentTokenInventory={agentTokenInventory}
        currentRole={currentRole}
        viewerMessage={errorMessage(viewer)}
        adminMessage={errorMessage(adminControlPlane)}
        onSignOut={() => {}}
      />

      {/* ── Stats row ── */}
      {session.data && (
        <section className="stats-row" data-testid="token-summary">
          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--blue">
              <Server size={20} />
            </div>
            <div className="stat-card__body">
              <p className="stat-card__value" data-testid="server-count">
                {servers.length}
              </p>
              <p className="stat-card__label">Servers</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--purple">
              <FolderKanban size={20} />
            </div>
            <div className="stat-card__body">
              <p className="stat-card__value">{projects.length}</p>
              <p className="stat-card__label">Projects</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--green">
              <Rocket size={20} />
            </div>
            <div className="stat-card__body">
              <p className="stat-card__value">{deployments.length}</p>
              <p className="stat-card__label">Recent Deploys</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--amber">
              <Layers size={20} />
            </div>
            <div className="stat-card__body">
              <p className="stat-card__value">
                {overview.data?.architecture.controlPlane.length ?? 0}
              </p>
              <p className="stat-card__label">Services</p>
            </div>
          </div>
        </section>
      )}

      {/* ── Server Health ── */}
      {session.data && serverChecks.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section__title">
            <Activity size={18} />
            Server Health
          </h2>
          <div className="server-health-grid">
            {serverChecks.map((s) => (
              <div className="server-health-card" key={String(s.serverId ?? s.serverName)}>
                <div className="server-health-card__top">
                  <span className="server-health-card__name">{String(s.serverName)}</span>
                  {s.sshReachable ? (
                    <span className="badge badge--green">
                      <CheckCircle2 size={12} /> Online
                    </span>
                  ) : (
                    <span className="badge badge--red">
                      <XCircle size={12} /> Offline
                    </span>
                  )}
                </div>
                <p className="server-health-card__detail">
                  {String(s.serverHost ?? "—")} · Docker {s.dockerReachable ? "✓" : "✗"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent Deployments ── */}
      {session.data && deployments.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section__title">
            <Clock size={18} />
            Recent Deployments
          </h2>
          <div className="deploy-table-wrap">
            <table className="deploy-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Triggered</th>
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
        </section>
      )}
    </main>
  );
}
