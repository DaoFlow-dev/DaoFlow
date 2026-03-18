import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";

interface Service {
  id: string;
  name: string;
  sourceType: string;
  imageReference: string | null;
  composeServiceName: string | null;
  dockerfilePath: string | null;
  status: string;
}

interface ProjectServicesListProps {
  services: Service[];
  isLoading: boolean;
  activeEnv: string | null;
  activeEnvName?: string;
}

export function ProjectServicesList({
  services,
  isLoading,
  activeEnv,
  activeEnvName
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
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : services.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {activeEnv
              ? "No services in this environment."
              : "No services yet. Add your first Docker or Compose service."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {services.map((svc) => (
            <Card
              key={svc.id}
              className="hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => void navigate(`/services/${svc.id}`)}
            >
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      svc.status === "active" || svc.status === "healthy"
                        ? "bg-green-500"
                        : svc.status === "failed"
                          ? "bg-red-500"
                          : "bg-gray-400"
                    }`}
                  />
                  <div>
                    <p className="font-medium">{svc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {svc.sourceType} ·{" "}
                      {svc.imageReference || svc.composeServiceName || svc.dockerfilePath || "—"}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={
                    svc.status === "active" || svc.status === "healthy"
                      ? "default"
                      : svc.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {svc.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
