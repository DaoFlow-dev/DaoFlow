import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { getInventoryBadgeVariant, getInventoryDotClass } from "@/lib/tone-utils";

interface Service {
  id: string;
  name: string;
  sourceType: string;
  imageReference: string | null;
  composeServiceName: string | null;
  dockerfilePath: string | null;
  status: string;
  statusTone?: string;
  statusLabel?: string;
  runtimeSummary?: {
    statusLabel: string;
    statusTone: string;
    summary: string;
  };
  rolloutStrategy?: {
    label: string;
    downtimeRisk: string;
  };
  latestDeployment?: {
    targetServerName: string | null;
    imageTag: string | null;
  } | null;
  endpointSummary?: {
    statusLabel: string;
    statusTone: string;
    primaryHref: string | null;
    summary: string;
    links: Array<{
      id: string;
      copyValue: string;
      statusLabel: string;
      statusTone: string;
    }>;
  } | null;
}

interface ProjectServicesListProps {
  services: Service[];
  isLoading: boolean;
  activeEnv: string | null;
  activeEnvName?: string;
  onCreateService?: () => void;
  deployHref?: string | null;
}

export function ProjectServicesList({
  services,
  isLoading,
  activeEnv,
  activeEnvName,
  onCreateService,
  deployHref
}: ProjectServicesListProps) {
  const navigate = useNavigate();

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          Services
          {activeEnv && activeEnvName && (
            <span className="text-sm text-muted-foreground ml-2">({activeEnvName})</span>
          )}
        </h2>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : services.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-12">
            <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
              <h3 className="text-base font-medium text-foreground">
                {activeEnv && activeEnvName
                  ? `No services in ${activeEnvName} yet`
                  : "No services yet"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {activeEnv && activeEnvName
                  ? "Create your first service for this environment or start from a template-backed deployment without losing the selected context."
                  : "Create your first service to turn this project into a real deployment target."}
              </p>
              {onCreateService || deployHref ? (
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  {onCreateService ? (
                    <Button onClick={onCreateService} data-testid="project-services-empty-add">
                      Create First Service
                    </Button>
                  ) : null}
                  {deployHref ? (
                    <Link to={deployHref} data-testid="project-services-empty-deploy-link">
                      <Button variant="outline">Deploy from Template</Button>
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {services.map((svc) => (
            <Card
              key={svc.id}
              className="shadow-sm hover:border-primary/30 transition-all duration-200 hover:shadow-md cursor-pointer"
              onClick={() => void navigate(`/services/${svc.id}`)}
            >
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-2 w-2 rounded-full ${getInventoryDotClass(
                      svc.runtimeSummary?.statusTone ?? svc.statusTone ?? svc.status,
                      {
                        pulse:
                          (svc.runtimeSummary?.statusTone ?? svc.statusTone ?? svc.status) ===
                          "running"
                      }
                    )}`}
                  />
                  <div>
                    <p className="font-medium">{svc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {svc.runtimeSummary?.summary ??
                        `${svc.sourceType} · ${
                          svc.latestDeployment?.imageTag ??
                          svc.imageReference ??
                          svc.composeServiceName ??
                          svc.dockerfilePath ??
                          "—"
                        }`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {svc.rolloutStrategy?.label ?? svc.sourceType}
                      {svc.latestDeployment?.targetServerName
                        ? ` · ${svc.latestDeployment.targetServerName}`
                        : ""}
                    </p>
                    {svc.endpointSummary ? (
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid={`project-service-endpoint-summary-${svc.id}`}
                      >
                        {svc.endpointSummary.primaryHref ??
                          svc.endpointSummary.links[0]?.copyValue ??
                          svc.endpointSummary.summary}
                        {" · "}
                        {svc.endpointSummary.statusLabel}
                      </p>
                    ) : null}
                  </div>
                </div>
                <Badge
                  variant={getInventoryBadgeVariant(
                    svc.runtimeSummary?.statusTone ?? svc.statusTone ?? svc.status
                  )}
                >
                  {svc.runtimeSummary?.statusLabel ?? svc.statusLabel ?? svc.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
