import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DeploymentRecoveryGuidanceData } from "@/pages/deployments-page/types";

interface DeploymentRecoveryGuidanceProps {
  deploymentId: string;
  guidance: DeploymentRecoveryGuidanceData;
}

export default function DeploymentRecoveryGuidance({
  deploymentId,
  guidance
}: DeploymentRecoveryGuidanceProps) {
  return (
    <section
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
      data-testid={`deployment-recovery-guidance-${deploymentId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-700" />
            <p className="text-sm font-semibold text-foreground">Recovery guidance</p>
          </div>
          <p className="text-sm text-muted-foreground">{guidance.summary}</p>
        </div>
        <Badge variant={guidance.source === "watchdog" ? "destructive" : "outline"}>
          {guidance.source === "watchdog" ? "Watchdog timeout" : "Deployment insight"}
        </Badge>
      </div>

      {guidance.suspectedRootCause ? (
        <p
          className="mt-3 text-sm text-muted-foreground"
          data-testid={`deployment-recovery-root-cause-${deploymentId}`}
        >
          Suspected root cause: {guidance.suspectedRootCause}
        </p>
      ) : null}

      {guidance.safeActions.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recommended next steps
          </p>
          <ul className="space-y-1 pl-4 text-sm text-muted-foreground">
            {guidance.safeActions.map((action) => (
              <li key={action} className="list-disc">
                {action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {guidance.evidence.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {guidance.evidence.map((item) => (
            <Badge
              variant="outline"
              key={`${item.kind}-${item.id}`}
              data-testid={`deployment-recovery-evidence-${deploymentId}-${item.id}`}
            >
              {item.kind}:{item.title}
            </Badge>
          ))}
        </div>
      ) : null}
    </section>
  );
}
