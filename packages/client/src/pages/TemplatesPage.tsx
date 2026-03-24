import { useDeferredValue, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAppTemplates, renderAppTemplate, type RenderedAppTemplate } from "@daoflow/shared";
import { Search } from "lucide-react";
import { TemplateCatalog } from "@/components/templates-page/TemplateCatalog";
import { TemplateConfigurationCard } from "@/components/templates-page/TemplateConfigurationCard";
import { Input } from "@/components/ui/input";
import { trpc } from "../lib/trpc";
import type {
  TemplateDeployResult,
  TemplateFieldValues,
  TemplateServerOption
} from "@/components/templates-page/types";
import { defaultFieldValues } from "@/components/templates-page/utils";

const templateCatalog = listAppTemplates();
const fallbackTemplate = templateCatalog[0];

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
  const [fieldValues, setFieldValues] = useState<TemplateFieldValues>(
    activeTemplate ? defaultFieldValues(activeTemplate) : {}
  );
  const [selectedServerId, setSelectedServerId] = useState("");
  const [previewRequested, setPreviewRequested] = useState(false);
  const [deployPending, setDeployPending] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<TemplateDeployResult | null>(null);

  const servers: TemplateServerOption[] = (
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

  function handleProjectNameChange(value: string) {
    setProjectName(value);
    setPreviewRequested(false);
    setDeployResult(null);
  }

  function handleServerChange(value: string) {
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
          <h1 className="font-display text-2xl font-bold tracking-tight">Templates</h1>
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
        <TemplateCatalog
          matchingTemplates={matchingTemplates}
          activeSlug={activeTemplate.slug}
          onSelectTemplate={setActiveSlug}
        />
        <TemplateConfigurationCard
          activeTemplate={activeTemplate}
          projectName={projectName}
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
    </main>
  );
}
