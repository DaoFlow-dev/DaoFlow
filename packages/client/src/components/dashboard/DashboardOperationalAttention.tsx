import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";
import { Rocket } from "lucide-react";

export interface DashboardServerCheck {
  serverId: string | number;
  serverName: string | number;
  serverHost: string | number;
  readinessStatus: string;
  dockerReachable?: boolean;
}

export interface DashboardDeploymentSummary {
  id: string | number;
  projectId?: string | number | null;
  serviceId?: string | null;
  serviceName?: string | number | null;
  sourceType?: string | number | null;
  status?: string | number | null;
  statusLabel?: string;
  statusTone?: string;
  createdAt?: string | Date | null;
}

export function DashboardOperationalAttention({
  attentionServers,
  attentionDeployments,
  onOpenDeploy,
  onReviewServers,
  onReviewDeployments
}: {
  attentionServers: DashboardServerCheck[];
  attentionDeployments: DashboardDeploymentSummary[];
  onOpenDeploy: () => void;
  onReviewServers: () => void;
  onReviewDeployments: () => void;
}) {
  if (attentionServers.length === 0 && attentionDeployments.length === 0) return null;

  return (
    <Card data-testid="dashboard-operational-attention">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base font-semibold">Operational Attention</CardTitle>
          <CardDescription>
            Surface failures and recovery actions before the next rollout.
          </CardDescription>
        </div>
        <Badge variant={getBadgeVariantFromTone("failed")}>Needs review</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Servers needing review</h2>
            {attentionServers.length > 0 ? (
              attentionServers.slice(0, 3).map((check) => (
                <div
                  key={String(check.serverId)}
                  className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
                  data-testid={`dashboard-attention-server-${String(check.serverId)}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{String(check.serverName)}</p>
                      <p className="text-muted-foreground">
                        {String(check.serverHost)} · {String(check.readinessStatus)}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={onReviewServers}>
                      Open Servers
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No server issues detected.</p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Deployments needing recovery</h2>
            {attentionDeployments.length > 0 ? (
              attentionDeployments.slice(0, 3).map((deployment) => (
                <div
                  key={String(deployment.id)}
                  className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
                  data-testid={`dashboard-attention-deployment-${String(deployment.id)}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {String(deployment.serviceName ?? deployment.projectId ?? "Deployment")}
                      </p>
                      <p className="text-muted-foreground">
                        {deployment.statusLabel ?? String(deployment.status ?? "")}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={onReviewDeployments}>
                      Review
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No failed deployments detected.</p>
            )}
          </section>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onOpenDeploy} data-testid="dashboard-open-deploy">
            <Rocket className="mr-1.5 h-4 w-4" />
            Open Deploy
          </Button>
          {attentionServers.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onReviewServers}
              data-testid="dashboard-review-servers"
            >
              Review Servers
            </Button>
          ) : null}
          {attentionDeployments.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onReviewDeployments}
              data-testid="dashboard-review-deployments"
            >
              Review Deployments
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
