/* eslint-disable @typescript-eslint/no-base-to-string */
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Server, Plus, CheckCircle2, XCircle } from "lucide-react";

export default function ServersPage() {
  const session = useSession();
  const serverReadiness = trpc.serverReadiness.useQuery({}, { enabled: Boolean(session.data) });
  const infra = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });

  const servers = infra.data?.servers ?? [];
  const checks = serverReadiness.data?.checks ?? [];

  return (
    <main className="shell">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Servers</h1>
          <p className="page-header__desc">Manage your Docker host servers and connectivity.</p>
        </div>
        <button className="action-button" disabled>
          <Plus size={16} /> Add Server
        </button>
      </div>

      {!session.data ? (
        <div className="empty-state">
          <p>Sign in to view servers.</p>
        </div>
      ) : servers.length === 0 && checks.length === 0 ? (
        <div className="empty-state">
          <Server size={32} />
          <p>No servers registered. Add your first server to get started.</p>
        </div>
      ) : (
        <div className="server-grid">
          {checks.map((s) => (
            <div className="server-card" key={String(s.serverId)}>
              <div className="server-card__top">
                <span className="server-card__name">{String(s.serverName)}</span>
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
              <p className="server-card__detail">
                {String(s.serverHost)} · Port {String(s.sshPort)}
              </p>
              <p className="server-card__detail">
                Docker: {s.dockerReachable ? "Connected ✓" : "Unreachable ✗"} · SSH:{" "}
                {s.sshReachable ? "OK" : "Failed"}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
