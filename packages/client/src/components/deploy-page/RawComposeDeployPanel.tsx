import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Code2, Eye, Rocket } from "lucide-react";
import { ComposePlanPreview } from "@/components/deploy-page/ComposePlanPreview";
import { TemplateDeployResultAlert } from "@/components/templates-page/TemplateDeployResultAlert";
import type { TemplateDeployResult, TemplateServerOption } from "@/components/templates-page/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

const DEFAULT_COMPOSE = `services:\n  app:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n`;

export function RawComposeDeployPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inventory = trpc.infrastructureInventory.useQuery(undefined);
  const handoffServerId = searchParams.get("serverId") ?? "";
  const handoffServerName = searchParams.get("serverName") ?? "";
  const handoffProjectId = searchParams.get("projectId") ?? "";
  const handoffProjectName = searchParams.get("projectName") ?? "";
  const handoffEnvironmentName = searchParams.get("environmentName") ?? "";
  const hasProjectEnvironmentContext = Boolean(handoffProjectId && handoffEnvironmentName);
  const hasLockedServerHandoff = Boolean(handoffServerId && hasProjectEnvironmentContext);
  const [projectName, setProjectName] = useState(handoffProjectName);
  const [environmentName, setEnvironmentName] = useState(handoffEnvironmentName || "production");
  const [selectedServerId, setSelectedServerId] = useState(handoffServerId);
  const [composeInput, setComposeInput] = useState(DEFAULT_COMPOSE);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [deployPending, setDeployPending] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<TemplateDeployResult | null>(null);

  const serversFromInventory: TemplateServerOption[] = (
    (inventory.data?.servers ?? []) as Array<{
      id: string;
      name: string;
      host?: string | null;
      targetKind?: string | null;
    }>
  ).map((server) => ({
    id: server.id,
    name: server.name,
    host: server.host ?? "unknown host",
    targetKind: server.targetKind ?? "docker-engine"
  }));

  const servers = useMemo(
    () =>
      handoffServerId && !serversFromInventory.some((server) => server.id === handoffServerId)
        ? [
            {
              id: handoffServerId,
              name: handoffServerName || "Setup server",
              host: "from setup",
              targetKind: "docker-engine"
            },
            ...serversFromInventory
          ]
        : serversFromInventory,
    [handoffServerId, handoffServerName, serversFromInventory]
  );

  useEffect(() => {
    if (hasProjectEnvironmentContext) {
      setProjectName(handoffProjectName);
      setEnvironmentName(handoffEnvironmentName);
    }

    if (hasLockedServerHandoff) {
      setSelectedServerId(handoffServerId);
      return;
    }

    if (!selectedServerId && servers.length > 0) {
      setSelectedServerId(servers[0].id);
    }
  }, [
    handoffEnvironmentName,
    handoffProjectName,
    handoffServerId,
    hasLockedServerHandoff,
    hasProjectEnvironmentContext,
    selectedServerId,
    servers
  ]);

  const previewInput =
    previewRequested && selectedServerId && composeInput.trim()
      ? {
          server: selectedServerId,
          compose: composeInput,
          composeFiles: [
            {
              path: "compose.yaml",
              contents: composeInput
            }
          ],
          composePath: "compose.yaml",
          contextPath: ".",
          localBuildContexts: [],
          requiresContextUpload: false
        }
      : null;

  const previewPlan = trpc.composeDeploymentPlan.useQuery(
    previewInput ?? {
      server: "",
      compose: "services: {}\n",
      localBuildContexts: [],
      requiresContextUpload: false
    },
    {
      enabled: Boolean(previewInput)
    }
  );

  const handoffSummary = hasProjectEnvironmentContext
    ? {
        projectName: handoffProjectName,
        environmentName: handoffEnvironmentName,
        serverName: hasLockedServerHandoff
          ? (servers.find((server) => server.id === handoffServerId)?.name ??
            handoffServerName ??
            "Selected server")
          : null
      }
    : null;

  function resetPreviewState() {
    setPreviewRequested(false);
    setDeployError(null);
    setDeployResult(null);
  }

  async function handleApply() {
    if (!selectedServerId || !composeInput.trim() || !previewPlan.data) {
      return;
    }

    setDeployPending(true);
    setDeployError(null);
    setDeployResult(null);

    try {
      const response = await window.fetch("/api/v1/deploy/compose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          server: selectedServerId,
          compose: composeInput,
          project: hasProjectEnvironmentContext ? handoffProjectId : projectName.trim(),
          environment: environmentName.trim()
        })
      });
      const body = (await response.json()) as {
        ok?: boolean;
        deploymentId?: string;
        projectId?: string;
        environmentId?: string;
        serviceId?: string;
        error?: string;
      };

      if (
        !response.ok ||
        !body.ok ||
        !body.deploymentId ||
        !body.projectId ||
        !body.environmentId ||
        !body.serviceId
      ) {
        throw new Error(body.error ?? "Unable to queue the raw compose deployment.");
      }

      setDeployResult({
        deploymentId: body.deploymentId,
        projectName: projectName.trim(),
        projectId: body.projectId,
        environmentId: body.environmentId,
        serviceId: body.serviceId
      });
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeployPending(false);
    }
  }

  return (
    <Card className="border-border/60 shadow-sm" data-testid="raw-compose-deploy-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code2 size={18} />
          Raw Compose
        </CardTitle>
        <CardDescription>
          Paste a Compose file, preview the target plan, then queue the deployment directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {handoffSummary ? (
          <Alert data-testid="raw-compose-handoff-summary">
            <AlertTitle>Target context active</AlertTitle>
            <AlertDescription>
              Deploying into {handoffSummary.projectName} / {handoffSummary.environmentName}
              {handoffSummary.serverName ? ` on ${handoffSummary.serverName}` : ""}. Project and
              environment stay locked to this target
              {hasLockedServerHandoff
                ? " and the server stays locked too."
                : ", but you can choose the server below."}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="raw-compose-project-name">Project name</Label>
            <Input
              id="raw-compose-project-name"
              value={projectName}
              disabled={hasProjectEnvironmentContext}
              onChange={(event) => {
                setProjectName(event.target.value);
                resetPreviewState();
              }}
              data-testid="raw-compose-project-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="raw-compose-environment-name">Environment name</Label>
            <Input
              id="raw-compose-environment-name"
              value={environmentName}
              disabled={hasProjectEnvironmentContext}
              onChange={(event) => {
                setEnvironmentName(event.target.value);
                resetPreviewState();
              }}
              data-testid="raw-compose-environment-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="raw-compose-server-select">Target server</Label>
            <Select
              value={selectedServerId}
              onValueChange={(value) => {
                setSelectedServerId(value);
                resetPreviewState();
              }}
            >
              <SelectTrigger
                id="raw-compose-server-select"
                disabled={hasLockedServerHandoff}
                data-testid="raw-compose-server-select"
              >
                <SelectValue
                  placeholder={inventory.isLoading ? "Loading servers..." : "Select a server"}
                />
              </SelectTrigger>
              <SelectContent>
                {servers.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    {server.name} · {server.host} · {server.targetKind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="raw-compose-input">Compose file</Label>
          <Textarea
            id="raw-compose-input"
            value={composeInput}
            onChange={(event) => {
              setComposeInput(event.target.value);
              resetPreviewState();
            }}
            rows={14}
            data-testid="raw-compose-input"
          />
        </div>

        {deployError ? (
          <Alert variant="destructive" data-testid="raw-compose-apply-error">
            <AlertTitle>Deployment failed</AlertTitle>
            <AlertDescription>{deployError}</AlertDescription>
          </Alert>
        ) : null}

        {deployResult ? (
          <TemplateDeployResultAlert
            deployResult={deployResult}
            onOpenDeployments={() => void navigate("/deployments")}
            onOpenService={() => void navigate(`/services/${deployResult.serviceId}`)}
          />
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => setPreviewRequested(true)}
            disabled={
              !selectedServerId ||
              !projectName.trim() ||
              !environmentName.trim() ||
              !composeInput.trim()
            }
            data-testid="raw-compose-preview-button"
          >
            <Eye size={14} className="mr-2" />
            Preview plan
          </Button>
          <Button
            onClick={() => void handleApply()}
            disabled={
              !selectedServerId ||
              !projectName.trim() ||
              !environmentName.trim() ||
              !composeInput.trim() ||
              deployPending ||
              !previewRequested ||
              !previewPlan.data ||
              Boolean(previewPlan.error)
            }
            data-testid="raw-compose-apply-button"
          >
            <Rocket size={14} className="mr-2" />
            {deployPending ? "Queueing..." : "Queue deployment"}
          </Button>
        </div>

        {previewRequested ? <ComposePlanPreview previewPlan={previewPlan} /> : null}
      </CardContent>
    </Card>
  );
}
