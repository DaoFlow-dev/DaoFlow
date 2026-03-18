import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";
import { getServerReadinessTone } from "../../lib/tone-utils";

interface ServerCheck {
  serverId: string;
  serverName: string;
  serverHost: string;
  serverStatus: string;
  targetKind: string;
  sshPort: number;
  readinessStatus: string;
  statusTone?: string;
  sshReachable: boolean;
  dockerReachable: boolean;
  composeReachable: boolean;
  checkedAt: string;
  latencyMs: number | null;
  issues: string[];
  recommendedActions: string[];
}

interface ServerReadinessData {
  summary: {
    totalServers: number;
    readyServers: number;
    blockedServers: number;
    averageLatencyMs: number | null;
  };
  checks: ServerCheck[];
}

export interface ServerReadinessProps {
  session: { data: unknown };
  serverReadiness: { data?: ServerReadinessData };
  serverReadinessMessage: string | null;
  canManageServers: boolean;
  refreshOperationalViews: () => Promise<void>;
}

export function ServerReadiness({
  session,
  serverReadiness,
  serverReadinessMessage,
  canManageServers,
  refreshOperationalViews
}: ServerReadinessProps) {
  const [serverName, setServerName] = useState("edge-vps-2");
  const [serverHost, setServerHost] = useState("10.0.2.15");
  const [serverRegion, setServerRegion] = useState("us-central-1");
  const [serverSshPort, setServerSshPort] = useState("22");
  const [serverSshUser, setServerSshUser] = useState("root");
  const [serverSshPrivateKey, setServerSshPrivateKey] = useState("");
  const [serverKind, setServerKind] = useState<"docker-engine" | "docker-swarm-manager">(
    "docker-engine"
  );
  const [serverFeedback, setServerFeedback] = useState<string | null>(null);
  const registerServer = trpc.registerServer.useMutation();

  async function handleRegisterServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerFeedback(null);

    try {
      const server = await registerServer.mutateAsync({
        name: serverName,
        host: serverHost,
        region: serverRegion,
        sshPort: Number.parseInt(serverSshPort, 10),
        sshUser: serverSshUser || undefined,
        sshPrivateKey: serverSshPrivateKey || undefined,
        kind: serverKind
      });

      await refreshOperationalViews();
      setServerFeedback(`Registered ${server.name} and queued first connectivity checks.`);
    } catch (error) {
      setServerFeedback(
        isTRPCClientError(error) ? error.message : "Unable to register the server right now."
      );
    }
  }

  return (
    <section className="server-readiness">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Onboarding slice</p>
        <h2>Server readiness and onboarding</h2>
      </div>

      {session.data && canManageServers ? (
        <form className="server-onboarding" onSubmit={(event) => void handleRegisterServer(event)}>
          <div>
            <p className="roadmap-item__lane">Admin-only action</p>
            <h3>Register a target host</h3>
            <p className="deployment-card__meta">
              New servers start blocked until SSH, Docker Engine, and Compose probes pass.
            </p>
          </div>
          <label>
            Server name
            <input value={serverName} onChange={(event) => setServerName(event.target.value)} />
          </label>
          <label>
            Server host
            <input value={serverHost} onChange={(event) => setServerHost(event.target.value)} />
          </label>
          <label>
            Server region
            <input value={serverRegion} onChange={(event) => setServerRegion(event.target.value)} />
          </label>
          <label>
            SSH port
            <input
              inputMode="numeric"
              value={serverSshPort}
              onChange={(event) => setServerSshPort(event.target.value)}
            />
          </label>
          <label>
            SSH user
            <input
              value={serverSshUser}
              onChange={(event) => setServerSshUser(event.target.value)}
            />
          </label>
          <label>
            SSH private key
            <textarea
              rows={6}
              value={serverSshPrivateKey}
              onChange={(event) => setServerSshPrivateKey(event.target.value)}
            />
          </label>
          <label>
            Target kind
            <select
              value={serverKind}
              onChange={(event) =>
                setServerKind(event.target.value as "docker-engine" | "docker-swarm-manager")
              }
            >
              <option value="docker-engine">docker-engine</option>
              <option value="docker-swarm-manager">docker-swarm-manager</option>
            </select>
          </label>
          <button className="action-button" disabled={registerServer.isPending} type="submit">
            {registerServer.isPending ? "Registering..." : "Register server"}
          </button>
          {serverFeedback ? (
            <p className="auth-feedback" data-testid="server-onboarding-feedback">
              {serverFeedback}
            </p>
          ) : null}
        </form>
      ) : session.data ? (
        <p className="viewer-empty">
          Elevated roles can register new target hosts here. Signed-in viewers can still inspect
          readiness checks below.
        </p>
      ) : null}

      {session.data && serverReadiness.data ? (
        <>
          <div className="server-readiness-summary" data-testid="server-readiness-summary">
            <div className="token-summary__item">
              <span className="metric__label">Servers</span>
              <strong>{serverReadiness.data.summary.totalServers}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Ready</span>
              <strong>{serverReadiness.data.summary.readyServers}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Blocked</span>
              <strong>{serverReadiness.data.summary.blockedServers}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Avg latency</span>
              <strong>
                {serverReadiness.data.summary.averageLatencyMs === null
                  ? "n/a"
                  : `${serverReadiness.data.summary.averageLatencyMs} ms`}
              </strong>
            </div>
          </div>

          <div className="server-readiness-list">
            {serverReadiness.data.checks.map((check) => {
              const statusTone = check.statusTone ?? getServerReadinessTone(check.readinessStatus);

              return (
                <article
                  className="timeline-event"
                  data-testid={`server-readiness-card-${check.serverId}`}
                  key={check.serverId}
                >
                  <div className="timeline-event__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {check.targetKind} · SSH {check.sshPort}
                      </p>
                      <h3>{check.serverName}</h3>
                    </div>
                    <span className={`deployment-status deployment-status--${statusTone}`}>
                      {check.readinessStatus}
                    </span>
                  </div>
                  <p className="deployment-card__meta">
                    {check.serverHost} · inventory status {check.serverStatus}
                  </p>
                  <p className="deployment-card__meta">
                    SSH {check.sshReachable ? "reachable" : "blocked"} · Docker{" "}
                    {check.dockerReachable ? "reachable" : "blocked"} · Compose{" "}
                    {check.composeReachable ? "reachable" : "blocked"}
                  </p>
                  <p className="deployment-card__meta">
                    Checked at {check.checkedAt} · Latency{" "}
                    {check.latencyMs === null ? "not measured" : `${check.latencyMs} ms`}
                  </p>
                  <div className="rollback-plan__columns">
                    <div>
                      <p className="roadmap-item__lane">Issues</p>
                      <ul className="deployment-card__steps">
                        {check.issues.length > 0 ? (
                          check.issues.map((issue) => <li key={issue}>{issue}</li>)
                        ) : (
                          <li>Connectivity checks are healthy.</li>
                        )}
                      </ul>
                    </div>
                    <div>
                      <p className="roadmap-item__lane">Recommended actions</p>
                      <ul className="deployment-card__steps">
                        {check.recommendedActions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {serverReadinessMessage ??
            "Sign in to inspect server onboarding readiness and connectivity issues."}
        </p>
      )}
    </section>
  );
}
