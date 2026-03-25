import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";
import { LifeBuoy, Rocket, ScrollText, ShieldAlert } from "lucide-react";

interface ServiceRecoveryPanelProps {
  serviceName: string;
  status: string;
  statusTone?: string;
  runtimeSummary?: {
    statusLabel: string;
    statusTone: string;
    summary: string;
    observedAt: string | null;
  };
  latestDeployment?: {
    id: string;
    statusLabel: string;
    statusTone: string;
    summary: string;
    targetServerName: string | null;
    imageTag: string | null;
    finishedAt: string | null;
  } | null;
  onOpenDeploy: () => void;
  onOpenDeployments: () => void;
  onOpenLogs: () => void;
}

export function ServiceRecoveryPanel({
  serviceName,
  status,
  statusTone,
  runtimeSummary,
  latestDeployment,
  onOpenDeploy,
  onOpenDeployments,
  onOpenLogs
}: ServiceRecoveryPanelProps) {
  const runtimeTone = runtimeSummary?.statusTone ?? statusTone ?? status;
  const runtimeLabel = runtimeSummary?.statusLabel ?? status;
  const needsAttention = runtimeTone === "failed" || latestDeployment?.statusTone === "failed";
  const showPanel = !latestDeployment || needsAttention;

  if (!showPanel) {
    return null;
  }

  return (
    <Card className="border-border/60 shadow-sm" data-testid="service-recovery-panel">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <LifeBuoy size={16} />
              Recovery and next actions
            </CardTitle>
            <CardDescription>
              Keep the current service state in view and jump straight into the recovery path when
              something fails.
            </CardDescription>
          </div>
          <Badge variant={getBadgeVariantFromTone(needsAttention ? "failed" : runtimeTone)}>
            {needsAttention ? "Needs attention" : "Healthy path"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
            <p className="font-medium">Runtime</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={getBadgeVariantFromTone(runtimeTone)}>{runtimeLabel}</Badge>
              <span className="text-muted-foreground">
                {runtimeSummary?.summary ?? serviceName}
              </span>
            </div>
            {runtimeSummary?.observedAt ? (
              <p className="mt-2 text-muted-foreground">
                Observed {new Date(runtimeSummary.observedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
            <p className="font-medium">Latest deployment</p>
            {latestDeployment ? (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant={getBadgeVariantFromTone(latestDeployment.statusTone)}>
                    {latestDeployment.statusLabel}
                  </Badge>
                  <span className="text-muted-foreground">{latestDeployment.summary}</span>
                </div>
                <p className="mt-2 text-muted-foreground">
                  {latestDeployment.targetServerName ?? "Unassigned target"}
                  {latestDeployment.imageTag ? ` · ${latestDeployment.imageTag}` : ""}
                </p>
                {latestDeployment.finishedAt ? (
                  <p className="mt-2 text-muted-foreground">
                    Finished {new Date(latestDeployment.finishedAt).toLocaleString()}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-muted-foreground">No deployment has finished yet.</p>
            )}
          </div>
        </div>

        {needsAttention ? (
          <Alert variant="destructive" data-testid="service-recovery-alert">
            <ShieldAlert size={16} />
            <AlertTitle>Recovery path ready</AlertTitle>
            <AlertDescription>
              Review recent deployment history or logs first, then queue a fresh deployment when you
              are ready to recover {serviceName}.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button onClick={onOpenDeploy} data-testid="service-recovery-open-deploy">
            <Rocket size={14} className="mr-2" />
            Queue deployment
          </Button>
          <Button
            variant="outline"
            onClick={onOpenDeployments}
            data-testid="service-recovery-open-deployments"
          >
            Review deployments
          </Button>
          <Button variant="outline" onClick={onOpenLogs} data-testid="service-recovery-open-logs">
            <ScrollText size={14} className="mr-2" />
            Open logs
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
