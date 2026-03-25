import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Eye, Play, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface ServiceOption {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  environmentName: string;
  sourceType: string;
  status: string;
  statusTone?: string;
  statusLabel?: string;
}

export function ServiceRolloutPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const servicesQuery = trpc.services.useQuery({ limit: 100 });
  const [selectedServiceId, setSelectedServiceId] = useState(searchParams.get("serviceId") ?? "");
  const [imageTag, setImageTag] = useState("");
  const [previewRequested, setPreviewRequested] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [queuedDeploymentId, setQueuedDeploymentId] = useState<string | null>(null);

  const services = (
    (servicesQuery.data ?? []) as Array<{
      id: string;
      name: string;
      projectId: string;
      projectName?: string | null;
      environmentName?: string | null;
      sourceType: string;
      status: string;
      statusTone?: string;
      statusLabel?: string;
    }>
  ).map(
    (service): ServiceOption => ({
      id: service.id,
      name: service.name,
      projectId: service.projectId,
      projectName: service.projectName ?? "Project",
      environmentName: service.environmentName ?? "Environment",
      sourceType: service.sourceType,
      status: service.status,
      statusTone: service.statusTone,
      statusLabel: service.statusLabel
    })
  );

  useEffect(() => {
    if (!selectedServiceId && services.length > 0) {
      setSelectedServiceId(services[0].id);
    }
  }, [selectedServiceId, services]);

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId) ?? null,
    [selectedServiceId, services]
  );

  const previewInput =
    previewRequested && selectedServiceId
      ? {
          service: selectedServiceId,
          image: imageTag.trim() || undefined
        }
      : null;

  const previewPlan = trpc.deploymentPlan.useQuery(
    previewInput ?? {
      service: "pending"
    },
    {
      enabled: Boolean(previewInput)
    }
  );

  const deploy = trpc.triggerDeploy.useMutation({
    onSuccess: (deployment) => {
      const deploymentId =
        deployment && typeof deployment === "object" && "id" in deployment
          ? String(deployment.id)
          : null;
      setQueuedDeploymentId(deploymentId);
      setDeploying(false);
      setDeployError(null);
    },
    onError: (error) => {
      setDeploying(false);
      setDeployError(error.message);
    }
  });

  function resetPreviewState() {
    setPreviewRequested(false);
    setQueuedDeploymentId(null);
    setDeployError(null);
  }

  function handleDeploy() {
    if (!selectedServiceId || !previewPlan.data) {
      return;
    }

    setDeploying(true);
    setQueuedDeploymentId(null);
    setDeployError(null);
    deploy.mutate({
      serviceId: selectedServiceId,
      imageTag: imageTag.trim() || undefined
    });
  }

  return (
    <Card className="border-border/60 shadow-sm" data-testid="service-rollout-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw size={18} />
          Registered Service Rollout
        </CardTitle>
        <CardDescription>
          Pick an existing service, preview the rollout plan, then queue a deployment against the
          registered runtime target.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="service-rollout-select">Service</Label>
            <Select
              value={selectedServiceId}
              onValueChange={(value) => {
                setSelectedServiceId(value);
                resetPreviewState();
              }}
            >
              <SelectTrigger id="service-rollout-select" data-testid="service-rollout-select">
                <SelectValue
                  placeholder={servicesQuery.isLoading ? "Loading services..." : "Select a service"}
                />
              </SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.projectName} / {service.environmentName} / {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-rollout-image">Image tag override (optional)</Label>
            <Input
              id="service-rollout-image"
              value={imageTag}
              onChange={(event) => {
                setImageTag(event.target.value);
                resetPreviewState();
              }}
              placeholder="ghcr.io/org/app:sha-123"
              data-testid="service-rollout-image"
            />
          </div>
        </div>

        {selectedService ? (
          <div
            className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm"
            data-testid="service-rollout-summary"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{selectedService.name}</p>
                <p className="text-muted-foreground">
                  {selectedService.projectName} / {selectedService.environmentName} ·{" "}
                  {selectedService.sourceType}
                </p>
              </div>
              <Badge
                variant={getBadgeVariantFromTone(
                  selectedService.statusTone ?? selectedService.status
                )}
              >
                {selectedService.statusLabel ?? selectedService.status}
              </Badge>
            </div>
          </div>
        ) : null}

        {deployError ? (
          <Alert variant="destructive" data-testid="service-rollout-error">
            <AlertTitle>Deployment failed</AlertTitle>
            <AlertDescription>{deployError}</AlertDescription>
          </Alert>
        ) : null}

        {queuedDeploymentId ? (
          <Alert data-testid="service-rollout-success">
            <AlertTitle>Deployment queued</AlertTitle>
            <AlertDescription>
              Deployment {queuedDeploymentId} was queued for{" "}
              {selectedService?.name ?? "the service"}.
            </AlertDescription>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate("/deployments")}
                data-testid="service-rollout-open-deployments"
              >
                Open Deployments
              </Button>
              {selectedService ? (
                <Button
                  size="sm"
                  onClick={() => void navigate(`/services/${selectedService.id}`)}
                  data-testid="service-rollout-open-service"
                >
                  Open Service
                </Button>
              ) : null}
            </div>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => setPreviewRequested(true)}
            disabled={!selectedServiceId}
            data-testid="service-rollout-preview-button"
          >
            <Eye size={14} className="mr-2" />
            Preview rollout
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={
              !selectedServiceId ||
              deploying ||
              !previewRequested ||
              !previewPlan.data ||
              Boolean(previewPlan.error)
            }
            data-testid="service-rollout-apply-button"
          >
            <Play size={14} className="mr-2" />
            {deploying ? "Queueing..." : "Queue deployment"}
          </Button>
        </div>

        {previewRequested ? (
          <section className="space-y-4" data-testid="service-rollout-preview">
            {previewPlan.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading rollout preview…</p>
            ) : previewPlan.error ? (
              <Alert variant="destructive" data-testid="service-rollout-preview-error">
                <AlertTitle>Preview failed</AlertTitle>
                <AlertDescription>{previewPlan.error.message}</AlertDescription>
              </Alert>
            ) : previewPlan.data ? (
              <>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
                  <p className="font-medium">Target</p>
                  <p className="mt-2 text-muted-foreground">
                    {previewPlan.data.service.projectName} /{" "}
                    {previewPlan.data.service.environmentName}
                  </p>
                  <p className="text-muted-foreground">
                    {previewPlan.data.target.serverName ?? "unassigned"} ·{" "}
                    {previewPlan.data.target.targetKind ?? "unassigned"}
                  </p>
                  <p className="text-muted-foreground">
                    {previewPlan.data.target.imageTag ?? "derived at runtime"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
                  <p className="font-medium">Pre-flight checks</p>
                  <ul className="mt-2 space-y-2 text-muted-foreground">
                    {previewPlan.data.preflightChecks.map((check) => (
                      <li key={`${check.status}-${check.detail}`}>
                        {check.status} · {check.detail}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
                  <p className="font-medium">Planned steps</p>
                  <ol className="mt-2 space-y-2 text-muted-foreground">
                    {previewPlan.data.steps.map((step, index) => (
                      <li key={step}>
                        {index + 1}. {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
