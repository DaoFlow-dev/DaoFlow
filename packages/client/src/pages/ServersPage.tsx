import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Server, Plus, CheckCircle2, XCircle } from "lucide-react";

export default function ServersPage() {
  const session = useSession();
  const serverReadiness = trpc.serverReadiness.useQuery({}, { enabled: Boolean(session.data) });

  const checks = serverReadiness.data?.checks ?? [];

  return (
    <main className="shell space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Servers</h1>
          <p className="text-sm text-muted-foreground">
            Manage your Docker host servers and connectivity.
          </p>
        </div>
        <Button disabled>
          <Plus size={16} /> Add Server
        </Button>
      </div>

      {checks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Server size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No servers registered. Add your first server to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {checks.map((s) => (
            <Card key={String(s.serverId)}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold">{String(s.serverName)}</CardTitle>
                <Badge variant={s.sshReachable ? "default" : "destructive"}>
                  {s.sshReachable ? (
                    <>
                      <CheckCircle2 size={12} /> Online
                    </>
                  ) : (
                    <>
                      <XCircle size={12} /> Offline
                    </>
                  )}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {String(s.serverHost)} · Port {String(s.sshPort)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Docker: {s.dockerReachable ? "Connected ✓" : "Unreachable ✗"}
                  {" · "}SSH: {s.sshReachable ? "OK" : "Failed"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
