import { useDeferredValue, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listAppTemplates,
  renderAppTemplate,
  type AppTemplateDefinition,
  type RenderedAppTemplate
} from "@daoflow/shared";
import { trpc } from "../lib/trpc";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Rocket, LayoutTemplate, Eye } from "lucide-react";

const templateCatalog = listAppTemplates();
const fallbackTemplate = templateCatalog[0];

function categoryLabel(category: AppTemplateDefinition["category"]) {
  switch (category) {
    case "application":
      return "Application";
    case "database":
      return "Database";
    case "cache":
      return "Cache";
    case "queue":
      return "Queue";
  }
}

function defaultFieldValues(template: AppTemplateDefinition) {
  return Object.fromEntries(
    template.fields
      .filter((field) => field.defaultValue)
      .map((field) => [field.key, field.defaultValue ?? ""])
  );
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const inventory = trpc.infrastructureInventory.useQuery(undefined);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const matchingTemplates = templateCatalog.filter((template) => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return (
      template.name.toLowerCase().includes(query) ||
      template.slug.toLowerCase().includes(query) ||
      template.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  });
  const [activeSlug, setActiveSlug] = useState<string>(fallbackTemplate?.slug ?? "");
  const activeTemplate =
    matchingTemplates.find((template) => template.slug === activeSlug) ??
    templateCatalog.find((template) => template.slug === activeSlug) ??
    fallbackTemplate;
  const [projectName, setProjectName] = useState(activeTemplate?.defaultProjectName ?? "");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(
    activeTemplate ? defaultFieldValues(activeTemplate) : {}
  );
  const [selectedServerId, setSelectedServerId] = useState("");
  const [previewRequested, setPreviewRequested] = useState(false);
  const [deployPending, setDeployPending] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<{
    deploymentId: string;
    projectName: string;
  } | null>(null);

  const servers = (
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

  useEffect(() => {
    if (!selectedServerId && servers.length > 0) {
      setSelectedServerId(servers[0].id);
    }
  }, [selectedServerId, servers]);

  useEffect(() => {
    if (!activeTemplate) {
      return;
    }

    setProjectName(activeTemplate.defaultProjectName);
    setFieldValues(defaultFieldValues(activeTemplate));
    setPreviewRequested(false);
    setDeployError(null);
    setDeployResult(null);
  }, [activeTemplate]);

  useEffect(() => {
    if (!activeTemplate && matchingTemplates[0]) {
      setActiveSlug(matchingTemplates[0].slug);
    }
  }, [activeTemplate, matchingTemplates]);

  let renderedError: string | null = null;
  let rendered: RenderedAppTemplate | null = null;
  if (activeTemplate) {
    try {
      rendered = renderAppTemplate({
        slug: activeTemplate.slug,
        projectName,
        values: fieldValues
      });
    } catch (error) {
      renderedError = error instanceof Error ? error.message : String(error);
    }
  }

  const previewInput =
    previewRequested && rendered && selectedServerId
      ? {
          server: selectedServerId,
          compose: rendered.compose,
          composeFiles: [
            {
              path: `templates/${activeTemplate.slug}.yaml`,
              contents: rendered.compose
            }
          ],
          composePath: `templates/${activeTemplate.slug}.yaml`,
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

  async function handleApply() {
    if (!rendered || !selectedServerId) {
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
          compose: rendered.compose,
          project: rendered.projectName
        })
      });
      const body = (await response.json()) as {
        ok?: boolean;
        deploymentId?: string;
        error?: string;
      };

      if (!response.ok || !body.ok || !body.deploymentId) {
        throw new Error(body.error ?? "Unable to queue the template deployment.");
      }

      setDeployResult({
        deploymentId: body.deploymentId,
        projectName: rendered.projectName
      });
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeployPending(false);
    }
  }

  if (!activeTemplate) {
    return (
      <main className="shell" data-testid="templates-page">
        No templates available.
      </main>
    );
  }

  return (
    <main className="shell space-y-6" data-testid="templates-page">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Start from curated Compose stacks, preview the normal DaoFlow plan, then queue the
            deployment without hand-writing a compose file.
          </p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search templates..."
            className="pl-9"
            data-testid="templates-search"
          />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)]">
        <div className="grid gap-4 md:grid-cols-2" data-testid="templates-catalog">
          {matchingTemplates.map((template) => (
            <Card
              key={template.slug}
              className={
                template.slug === activeTemplate.slug
                  ? "border-primary/50 shadow-md"
                  : "border-border/60"
              }
              data-testid={`template-card-${template.slug}`}
            >
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    <CardDescription>{template.summary}</CardDescription>
                  </div>
                  <Badge variant="secondary" data-testid={`template-category-${template.slug}`}>
                    {categoryLabel(template.category)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {template.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{template.description}</p>
                <Button
                  variant={template.slug === activeTemplate.slug ? "default" : "outline"}
                  className="w-full"
                  onClick={() => setActiveSlug(template.slug)}
                  data-testid={`template-select-${template.slug}`}
                >
                  <LayoutTemplate size={14} className="mr-2" />
                  {template.slug === activeTemplate.slug ? "Selected" : "Configure template"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle data-testid="template-active-name">{activeTemplate.name}</CardTitle>
            <CardDescription>{activeTemplate.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="template-project-name">Project name</Label>
                <Input
                  id="template-project-name"
                  value={projectName}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    setPreviewRequested(false);
                    setDeployResult(null);
                  }}
                  data-testid="template-project-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-server-select">Target server</Label>
                <Select
                  value={selectedServerId}
                  onValueChange={(value) => {
                    setSelectedServerId(value);
                    setPreviewRequested(false);
                    setDeployResult(null);
                  }}
                >
                  <SelectTrigger id="template-server-select" data-testid="template-server-select">
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

            {activeTemplate.fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={`template-input-${field.key}`}>{field.label}</Label>
                <Input
                  id={`template-input-${field.key}`}
                  type={field.kind === "secret" ? "password" : "text"}
                  value={fieldValues[field.key] ?? ""}
                  onChange={(event) => {
                    setFieldValues((current) => ({ ...current, [field.key]: event.target.value }));
                    setPreviewRequested(false);
                    setDeployResult(null);
                  }}
                  placeholder={field.defaultValue ?? field.exampleValue ?? ""}
                  data-testid={`template-input-${field.key}`}
                />
                <p className="text-sm text-muted-foreground">{field.description}</p>
              </div>
            ))}

            <div className="grid gap-4 md:grid-cols-2">
              <section className="space-y-2" data-testid="template-services">
                <h2 className="text-sm font-semibold">Services</h2>
                {activeTemplate.services.map((service) => (
                  <div
                    key={service.name}
                    className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
                  >
                    <p className="font-medium">{service.name}</p>
                    <p className="text-muted-foreground">{service.summary}</p>
                  </div>
                ))}
              </section>
              <section className="space-y-2" data-testid="template-volumes">
                <h2 className="text-sm font-semibold">Volumes and health</h2>
                {activeTemplate.volumes.map((volume) => (
                  <div
                    key={volume.nameTemplate}
                    className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
                  >
                    <p className="font-medium">{volume.nameTemplate}</p>
                    <p className="text-muted-foreground">
                      {volume.mountPath} · {volume.summary}
                    </p>
                  </div>
                ))}
                {activeTemplate.healthChecks.map((check) => (
                  <div
                    key={`${check.serviceName}-${check.summary}`}
                    className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
                  >
                    <p className="font-medium">{check.serviceName}</p>
                    <p className="text-muted-foreground">{check.summary}</p>
                    <p className="mt-1 text-muted-foreground">{check.readinessHint}</p>
                  </div>
                ))}
              </section>
            </div>

            {renderedError ? (
              <Alert variant="destructive" data-testid="template-render-error">
                <AlertTitle>Template input needs attention</AlertTitle>
                <AlertDescription>{renderedError}</AlertDescription>
              </Alert>
            ) : null}

            {deployError ? (
              <Alert variant="destructive" data-testid="template-apply-error">
                <AlertTitle>Deployment failed</AlertTitle>
                <AlertDescription>{deployError}</AlertDescription>
              </Alert>
            ) : null}

            {deployResult ? (
              <Alert data-testid="template-apply-success">
                <AlertTitle>Deployment queued</AlertTitle>
                <AlertDescription>
                  Queued <strong>{deployResult.projectName}</strong> as deployment{" "}
                  <strong>{deployResult.deploymentId}</strong>.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => setPreviewRequested(true)}
                disabled={!selectedServerId || Boolean(renderedError)}
                data-testid="template-preview-button"
              >
                <Eye size={14} className="mr-2" />
                Preview plan
              </Button>
              <Button
                onClick={() => void handleApply()}
                disabled={!selectedServerId || Boolean(renderedError) || deployPending}
                data-testid="template-apply-button"
              >
                <Rocket size={14} className="mr-2" />
                {deployPending ? "Queueing..." : "Apply template"}
              </Button>
              {deployResult ? (
                <Button variant="secondary" onClick={() => void navigate("/deployments")}>
                  Open deployments
                </Button>
              ) : null}
            </div>

            {previewRequested ? (
              previewPlan.isLoading ? (
                <div className="space-y-3" data-testid="template-preview-loading">
                  <Skeleton className="h-6 w-40 rounded-lg" />
                  <Skeleton className="h-28 w-full rounded-lg" />
                  <Skeleton className="h-28 w-full rounded-lg" />
                </div>
              ) : previewPlan.error ? (
                <Alert variant="destructive" data-testid="template-preview-error">
                  <AlertTitle>Preview failed</AlertTitle>
                  <AlertDescription>{previewPlan.error.message}</AlertDescription>
                </Alert>
              ) : previewPlan.data ? (
                <section className="space-y-4" data-testid="template-preview-plan">
                  <div>
                    <h2 className="text-base font-semibold">Rendered Template Plan</h2>
                    <p className="text-sm text-muted-foreground">
                      This plan will not be executed until you apply the template.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
                      <p className="font-medium">Project scope</p>
                      <p className="mt-1 text-muted-foreground">
                        {previewPlan.data.project.name} · {previewPlan.data.project.action}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {previewPlan.data.environment.name} · {previewPlan.data.environment.action}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {previewPlan.data.service.name} · {previewPlan.data.service.action}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
                      <p className="font-medium">Target server</p>
                      <p className="mt-1 text-muted-foreground">
                        {previewPlan.data.target.serverName} · {previewPlan.data.target.serverHost}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {previewPlan.data.target.targetKind ?? "unassigned"}
                      </p>
                    </div>
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
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
                    <p className="font-medium">CLI handoff</p>
                    <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                      {previewPlan.data.executeCommand}
                    </p>
                  </div>
                </section>
              ) : null
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
