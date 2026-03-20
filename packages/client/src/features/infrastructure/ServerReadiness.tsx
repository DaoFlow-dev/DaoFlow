import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface ServerCheck {
  serverId: string;
  serverName: string;
  serverHost: string;
  serverStatus: string;
  targetKind: string;
  sshPort: number;
  readinessStatus: string;
  statusTone: string;
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
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Onboarding slice
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Server readiness and onboarding
        </h2>
      </div>

      {session.data && canManageServers ? (
        <form className="space-y-4" onSubmit={(event) => void handleRegisterServer(event)}>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Admin-only action
            </p>
            <h3 className="text-base font-semibold text-foreground">Register a target host</h3>
            <p className="mt-2 text-sm text-muted-foreground">
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
          <Button disabled={registerServer.isPending} type="submit">
            {registerServer.isPending ? "Registering..." : "Register server"}
          </Button>
          {serverFeedback ? (
            <p
              className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
              data-testid="server-onboarding-feedback"
            >
              {serverFeedback}
            </p>
          ) : null}
        </form>
      ) : session.data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Elevated roles can register new target hosts here. Signed-in viewers can still inspect
          readiness checks below.
        </p>
      ) : null}

      {session.data && serverReadiness.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="server-readiness-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Servers
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {serverReadiness.data.summary.totalServers}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Ready
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {serverReadiness.data.summary.readyServers}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Blocked
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {serverReadiness.data.summary.blockedServers}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Avg latency
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {serverReadiness.data.summary.averageLatencyMs === null
                  ? "n/a"
                  : `${serverReadiness.data.summary.averageLatencyMs} ms`}
              </strong>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {serverReadiness.data.checks.map((check) => (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`server-readiness-card-${check.serverId}`}
                key={check.serverId}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {check.targetKind} · SSH {check.sshPort}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">{check.serverName}</h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(check.statusTone)}>
                    {check.readinessStatus}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {check.serverHost} · inventory status {check.serverStatus}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  SSH {check.sshReachable ? "reachable" : "blocked"} · Docker{" "}
                  {check.dockerReachable ? "reachable" : "blocked"} · Compose{" "}
                  {check.composeReachable ? "reachable" : "blocked"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Checked at {check.checkedAt} · Latency{" "}
                  {check.latencyMs === null ? "not measured" : `${check.latencyMs} ms`}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Issues
                    </p>
                    <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                      {check.issues.length > 0 ? (
                        check.issues.map((issue) => <li key={issue}>{issue}</li>)
                      ) : (
                        <li>Connectivity checks are healthy.</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Recommended actions
                    </p>
                    <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                      {check.recommendedActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {serverReadinessMessage ??
            "Sign in to inspect server onboarding readiness and connectivity issues."}
        </p>
      )}
    </section>
  );
}
