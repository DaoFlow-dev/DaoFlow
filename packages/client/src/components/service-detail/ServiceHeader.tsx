import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, Square, RotateCcw, Trash2, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";

interface ServiceHeaderProps {
  service: {
    id: string;
    name: string;
    sourceType: string;
    status: string;
    projectId: string;
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
            <p className="text-sm text-muted-foreground">{service.sourceType} service</p>
          </div>
          <Badge variant={getInventoryBadgeVariant(service.status)}>{service.status}</Badge>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="default"
            onClick={() => handleAction("deploy")}
            disabled={!!actionInProgress}
          >
            {actionInProgress === "deploy" ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Play size={14} className="mr-1" />
            )}
            Deploy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("restart")}
            disabled={!!actionInProgress}
            title="Restart"
            aria-label="Restart service"
          >
            {actionInProgress === "restart" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("stop")}
            disabled={!!actionInProgress}
            title="Stop"
            aria-label="Stop service"
          >
            <Square size={14} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("redeploy")}
            disabled={!!actionInProgress}
            title="Redeploy"
            aria-label="Redeploy service"
          >
            <RotateCcw size={14} />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleAction("delete")}
            disabled={!!actionInProgress}
            title="Delete"
            aria-label="Delete service"
          >
            <Trash2 size={14} />
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
