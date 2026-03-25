import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listAppTemplates, renderAppTemplate, type RenderedAppTemplate } from "@daoflow/shared";
import { Search } from "lucide-react";
import { TemplateCatalog } from "@/components/templates-page/TemplateCatalog";
import { TemplateConfigurationCard } from "@/components/templates-page/TemplateConfigurationCard";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import type {
  TemplateDeployResult,
  TemplateFieldValues,
  TemplateServerOption
} from "@/components/templates-page/types";
import { defaultFieldValues } from "@/components/templates-page/utils";

const templateCatalog = listAppTemplates();
const fallbackTemplate = templateCatalog[0];

export function TemplateDeployPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inventory = trpc.infrastructureInventory.useQuery(undefined);
  const handoffServerId = searchParams.get("serverId") ?? "";
  const handoffServerName = searchParams.get("serverName") ?? "";
  const handoffProjectId = searchParams.get("projectId") ?? "";
  const handoffProjectName = searchParams.get("projectName") ?? "";
  const handoffEnvironmentName = searchParams.get("environmentName") ?? "";
  const hasSetupHandoff = Boolean(handoffServerId && handoffProjectId && handoffEnvironmentName);
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
  const [projectName, setProjectName] = useState(
    hasSetupHandoff ? handoffProjectName : (activeTemplate?.defaultProjectName ?? "")
  );
  const [fieldValues, setFieldValues] = useState<TemplateFieldValues>(
    activeTemplate ? defaultFieldValues(activeTemplate) : {}
  );
  const [selectedServerId, setSelectedServerId] = useState(handoffServerId);
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

  const handoffSummary = hasSetupHandoff
    ? {
        projectName: handoffProjectName || projectName,
        environmentName: handoffEnvironmentName,
        serverName:
          servers.find((server) => server.id === handoffServerId)?.name ??
          handoffServerName ??
          "Selected server"
      }
    : null;

  useEffect(() => {
    if (hasSetupHandoff) {
      setSelectedServerId(handoffServerId);
      return;
    }

    if (!selectedServerId && servers.length > 0) {
      setSelectedServerId(servers[0].id);
    }
  }, [handoffServerId, hasSetupHandoff, selectedServerId, servers]);

  useEffect(() => {
    if (!activeTemplate) {
      return;
    }

    setProjectName(
      hasSetupHandoff
        ? handoffProjectName || activeTemplate.defaultProjectName
        : activeTemplate.defaultProjectName
    );
    setFieldValues(defaultFieldValues(activeTemplate));
    setPreviewRequested(false);
    setDeployError(null);
    setDeployResult(null);
  }, [activeTemplate, handoffProjectName, hasSetupHandoff]);

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

  function handleProjectNameChange(value: string) {
    if (hasSetupHandoff) {
      return;
    }

    setProjectName(value);
    setPreviewRequested(false);
    setDeployResult(null);
  }

  function handleServerChange(value: string) {
    if (hasSetupHandoff) {
      return;
    }

    setSelectedServerId(value);
    setPreviewRequested(false);
    setDeployResult(null);
  }

  function handleFieldValueChange(key: string, value: string) {
    setFieldValues((current) => ({ ...current, [key]: value }));
    setPreviewRequested(false);
    setDeployResult(null);
  }

  async function handleApply() {
    if (!rendered || !selectedServerId || !previewPlan.data) {
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
          project: hasSetupHandoff ? handoffProjectId : rendered.projectName,
          environment: handoffEnvironmentName || "production"
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
        throw new Error(body.error ?? "Unable to queue the template deployment.");
      }

      setDeployResult({
        deploymentId: body.deploymentId,
        projectName: rendered.projectName,
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

  if (!activeTemplate) {
    return <div data-testid="template-deploy-panel">No templates available.</div>;
  }

  return (
    <section className="space-y-6" data-testid="template-deploy-panel">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Template Catalog</h2>
          <p className="text-sm text-muted-foreground">
            Pick a curated stack, preview the plan, then queue it into the project and environment
            you intend to operate.
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
        <TemplateCatalog
          matchingTemplates={matchingTemplates}
          activeSlug={activeTemplate.slug}
          onSelectTemplate={setActiveSlug}
        />
        <TemplateConfigurationCard
          activeTemplate={activeTemplate}
          projectName={projectName}
          handoffSummary={handoffSummary}
          projectNameLocked={hasSetupHandoff}
          serverLocked={hasSetupHandoff}
          fieldValues={fieldValues}
          selectedServerId={selectedServerId}
          servers={servers}
          inventoryLoading={inventory.isLoading}
          previewRequested={previewRequested}
          renderedError={renderedError}
          deployError={deployError}
          deployPending={deployPending}
          deployResult={deployResult}
          previewPlan={previewPlan}
          onProjectNameChange={handleProjectNameChange}
          onServerChange={handleServerChange}
          onFieldValueChange={handleFieldValueChange}
          onPreviewRequest={() => setPreviewRequested(true)}
          onApply={() => void handleApply()}
          onOpenDeployments={() => void navigate("/deployments")}
          onOpenService={() => void navigate(`/services/${deployResult?.serviceId ?? ""}`)}
        />
      </div>
    </section>
  );
}
