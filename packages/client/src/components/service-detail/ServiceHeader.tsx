import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, Loader2 } from "lucide-react";
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
  const [isDeploying, setIsDeploying] = useState(false);

  const deploy = trpc.triggerDeploy.useMutation({
    onSuccess: () => setIsDeploying(false),
    onError: () => setIsDeploying(false)
  });

  function handleDeploy() {
    setIsDeploying(true);
    deploy.mutate({ serviceId: service.id });
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
            data-testid={`service-back-to-project-${service.id}`}
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
            onClick={handleDeploy}
            disabled={isDeploying}
            data-testid={`service-deploy-${service.id}`}
          >
            {isDeploying ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Play size={14} className="mr-1" />
            )}
            {isDeploying ? "Deploying..." : "Deploy"}
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
