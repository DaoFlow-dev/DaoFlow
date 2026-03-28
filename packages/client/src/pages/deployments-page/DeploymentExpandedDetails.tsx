import { Badge } from "@/components/ui/badge";
import { DeploymentStateArtifacts } from "@/components/DeploymentStateArtifacts";
import DeploymentLogViewer from "@/components/DeploymentLogViewer";
import type { DeploymentRowData } from "./types";

interface DeploymentExpandedDetailsProps {
  deployment: DeploymentRowData;
  deploymentId: string;
}

export function DeploymentExpandedDetails({
  deployment,
  deploymentId
}: DeploymentExpandedDetailsProps) {
  const actorLabel =
    typeof deployment.requestedByEmail === "string" && deployment.requestedByEmail.length > 0
      ? deployment.requestedByEmail
      : "system";

  return (
    <div className="space-y-4 bg-muted/10 p-5 backdrop-blur-sm">
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Actor
          </p>
          <p className="text-sm font-medium">{actorLabel}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Commit
          </p>
          <p className="text-sm font-medium">{String(deployment.commitSha ?? "—")}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Image
          </p>
          <p className="truncate text-sm font-medium">{String(deployment.imageTag ?? "—")}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Outcome
          </p>
          <p className="text-sm font-medium">
            {typeof deployment.conclusion === "string" ? deployment.conclusion : "pending"}
          </p>
        </div>
      </div>
      {deployment.executionEngine === "temporal" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Temporal workflow
            </p>
            <p className="break-all text-sm font-medium">{deployment.temporalWorkflowId ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Temporal run
            </p>
            <p className="break-all text-sm font-medium">{deployment.temporalRunId ?? "—"}</p>
          </div>
        </div>
      ) : null}
      {Array.isArray(deployment.steps) && deployment.steps.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Structured steps
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {deployment.steps.map((step) => (
              <div
                key={String(step.id)}
                className="rounded-lg border border-border/50 bg-background p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{String(step.label)}</p>
                  <Badge variant="outline">
                    {typeof step.status === "string" ? step.status : "pending"}
                  </Badge>
                </div>
                {typeof step.detail === "string" && step.detail.length > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <DeploymentStateArtifacts deploymentId={deploymentId} artifacts={deployment.stateArtifacts} />
      <DeploymentLogViewer deploymentId={deploymentId} />
    </div>
  );
}
