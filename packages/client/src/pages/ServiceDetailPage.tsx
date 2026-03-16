import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Play, Settings2, Loader2 } from "lucide-react";

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const service = trpc.serviceDetails.useQuery({ serviceId: id! }, { enabled: !!id });

  const deploy = trpc.triggerDeploy.useMutation({
    onSuccess: (deployment) => {
      if (deployment?.id) {
        void navigate("/deployments");
      }
    }
  });

  if (service.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!service.data) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Service not found.
        <br />
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => {
            void navigate("/projects");
          }}
        >
          Back to Projects
        </Button>
      </div>
    );
  }

  const svc = service.data;

  function handleDeploy() {
    if (!id) return;
    deploy.mutate({ serviceId: id });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              void navigate(`/projects/${svc.projectId}`);
            }}
          >
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{svc.name}</h1>
            <p className="text-sm text-muted-foreground">{svc.sourceType} service</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={svc.status === "active" ? "default" : "secondary"}>{svc.status}</Badge>
          <Button size="sm" onClick={handleDeploy} disabled={deploy.isPending}>
            {deploy.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Play size={14} className="mr-1" />
            )}
            {deploy.isPending ? "Deploying…" : "Deploy"}
          </Button>
        </div>
      </div>

      {/* Deploy error */}
      {deploy.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3 text-sm text-destructive">
            {deploy.error.message}
          </CardContent>
        </Card>
      )}

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings2 size={14} /> Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Source Type</dt>
              <dd className="font-medium">{svc.sourceType}</dd>
            </div>
            {svc.imageReference && (
              <div>
                <dt className="text-muted-foreground">Image</dt>
                <dd className="font-mono text-xs">{svc.imageReference}</dd>
              </div>
            )}
            {svc.dockerfilePath && (
              <div>
                <dt className="text-muted-foreground">Dockerfile</dt>
                <dd className="font-mono text-xs">{svc.dockerfilePath}</dd>
              </div>
            )}
            {svc.composeServiceName && (
              <div>
                <dt className="text-muted-foreground">Compose Service</dt>
                <dd className="font-mono text-xs">{svc.composeServiceName}</dd>
              </div>
            )}
            {svc.port && (
              <div>
                <dt className="text-muted-foreground">Port</dt>
                <dd>{svc.port}</dd>
              </div>
            )}
            {svc.healthcheckPath && (
              <div>
                <dt className="text-muted-foreground">Health Check</dt>
                <dd className="font-mono text-xs">{svc.healthcheckPath}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
