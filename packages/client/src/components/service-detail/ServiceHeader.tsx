import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play } from "lucide-react";
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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          className="transition-colors hover:text-foreground"
          onClick={() => void navigate("/projects")}
        >
          Projects
        </button>
        <span>/</span>
        <button
          className="transition-colors hover:text-foreground"
          onClick={() => void navigate(`/projects/${service.projectId}`)}
        >
          {projectName ?? "Project"}
        </button>
        <span>/</span>
        <span className="font-medium text-foreground">{service.name}</span>
      </div>

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

        <Button
          size="sm"
          variant="default"
          onClick={() => void navigate(`/deploy?source=service&serviceId=${service.id}`)}
          data-testid={`service-deploy-${service.id}`}
        >
          <Play size={14} className="mr-1" />
          Deploy
        </Button>
      </div>
    </div>
  );
}
