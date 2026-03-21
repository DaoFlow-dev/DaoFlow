import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, Square, RotateCcw, Trash2, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface ServiceHeaderProps {
  service: {
    id: string;
    name: string;
    sourceType: string;
    status: string;
    statusTone?: string;
    statusLabel?: string;
    projectId: string;
    runtimeSummary?: {
      statusLabel: string;
      statusTone: string;
      summary: string;
    };
    rolloutStrategy?: {
      label: string;
      downtimeRisk: string;
      supportsZeroDowntime: boolean;
    };
  };
  projectName?: string;
}

export default function ServiceHeader({ service, projectName }: ServiceHeaderProps) {
  const navigate = useNavigate();
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const deploy = trpc.triggerDeploy.useMutation({
    onSuccess: () => setActionInProgress(null),
    onError: () => setActionInProgress(null)
  });

  function handleAction(action: string) {
    setActionInProgress(action);
    if (action === "deploy" || action === "restart") {
      deploy.mutate({ serviceId: service.id });
    } else {
      // stop/delete are placeholders until backend support
      setTimeout(() => setActionInProgress(null), 1000);
    }
  }

  function renderActionIcon(action: string, icon: ReactNode) {
    if (actionInProgress === action) {
      return <Loader2 size={14} className="animate-spin" />;
    }

    return icon;
  }

  return (
    <div className="space-y-2">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          className="hover:text-foreground transition-colors"
          onClick={() => void navigate("/projects")}
        >
          Projects
        </button>
        <span>/</span>
        <button
          className="hover:text-foreground transition-colors"
          onClick={() => void navigate(`/projects/${service.projectId}`)}
        >
          {projectName ?? "Project"}
        </button>
        <span>/</span>
        <span className="text-foreground font-medium">{service.name}</span>
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to project"
            onClick={() => void navigate(`/projects/${service.projectId}`)}
          >
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{service.name}</h1>
            <p className="text-sm text-muted-foreground">
              {service.sourceType} service
              {service.rolloutStrategy ? ` · ${service.rolloutStrategy.label}` : ""}
            </p>
            {service.runtimeSummary ? (
              <p className="text-sm text-muted-foreground">{service.runtimeSummary.summary}</p>
            ) : null}
          </div>
          <Badge
            variant={getBadgeVariantFromTone(
              service.runtimeSummary?.statusTone ?? service.statusTone ?? service.status
            )}
          >
            {service.runtimeSummary?.statusLabel ?? service.statusLabel ?? service.status}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="default"
            onClick={() => handleAction("deploy")}
            disabled={!!actionInProgress}
            data-testid={`service-deploy-${service.id}`}
          >
            {actionInProgress === "deploy" ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Play size={14} className="mr-1" />
            )}
            {actionInProgress === "deploy" ? "Deploying..." : "Deploy"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("restart")}
            disabled={!!actionInProgress}
            title="Restart"
            aria-label="Restart service"
            data-testid={`service-restart-${service.id}`}
          >
            {renderActionIcon("restart", <RefreshCw size={14} />)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("stop")}
            disabled={!!actionInProgress}
            title="Stop"
            aria-label="Stop service"
            data-testid={`service-stop-${service.id}`}
          >
            {renderActionIcon("stop", <Square size={14} />)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("redeploy")}
            disabled={!!actionInProgress}
            title="Redeploy"
            aria-label="Redeploy service"
            data-testid={`service-redeploy-${service.id}`}
          >
            {renderActionIcon("redeploy", <RotateCcw size={14} />)}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleAction("delete")}
            disabled={!!actionInProgress}
            title="Delete"
            aria-label="Delete service"
            data-testid={`service-delete-${service.id}`}
          >
            {renderActionIcon("delete", <Trash2 size={14} />)}
          </Button>
        </div>
      </div>

      {deploy.error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
          {deploy.error.message}
        </div>
      )}
    </div>
  );
}
