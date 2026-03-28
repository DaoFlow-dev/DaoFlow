import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, Eye, EyeOff, FileText, Save, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { EnvVarTable } from "./EnvVarTable";
import { RawEnvEditor } from "./RawEnvEditor";

interface EnvironmentTabProps {
  serviceId: string;
  environmentId?: string;
}

interface LayeredEnvVar {
  id: string;
  key: string;
  value: string;
  scope: "environment" | "service";
  scopeLabel: string;
  originSummary: string;
  branchPattern: string | null;
  isSecret: boolean;
  source: "inline" | "1password";
  category: "runtime" | "build";
}

interface ResolvedEnvVar {
  key: string;
  displayValue: string;
  isSecret: boolean;
  source: "inline" | "1password";
  category: "runtime" | "build";
  scope: "environment" | "service";
  scopeLabel: string;
  branchPattern: string | null;
  originSummary: string;
}

function normalizeCategory(category: string): "runtime" | "build" {
  return category === "build" ? "build" : "runtime";
}

export default function EnvironmentTab({ serviceId, environmentId }: EnvironmentTabProps) {
  const [mode, setMode] = useState<"table" | "raw">("table");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "runtime" | "build">("all");
  const [rawText, setRawText] = useState("");
  const [buildArgs, setBuildArgs] = useState("");
  const [buildSecrets, setBuildSecrets] = useState("");
  const [savedBuildArgs, setSavedBuildArgs] = useState("");
  const [savedBuildSecrets, setSavedBuildSecrets] = useState("");
  const [revealedResolvedKeys, setRevealedResolvedKeys] = useState<Set<string>>(new Set());

  const hasUnsavedChanges = buildArgs !== savedBuildArgs || buildSecrets !== savedBuildSecrets;

  const envQuery = trpc.environmentVariables.useQuery(
    { environmentId, serviceId, limit: 100 },
    { enabled: Boolean(environmentId) }
  );

  const upsertMutation = trpc.upsertEnvironmentVariable.useMutation({
    onSuccess: () => void envQuery.refetch()
  });
  const deleteMutation = trpc.deleteEnvironmentVariable.useMutation({
    onSuccess: () => void envQuery.refetch()
  });

  const vars: LayeredEnvVar[] =
    envQuery.data?.variables.map((variable) => ({
      id: variable.id,
      key: variable.key,
      value: variable.displayValue,
      scope: variable.scope,
      scopeLabel: variable.scopeLabel,
      originSummary: variable.originSummary,
      branchPattern: variable.branchPattern,
      isSecret: variable.isSecret,
      source: variable.source,
      category: normalizeCategory(variable.category)
    })) ?? [];
  const resolvedVars: ResolvedEnvVar[] =
    envQuery.data?.resolvedVariables.map((variable) => ({
      key: variable.key,
      displayValue: variable.displayValue,
      isSecret: variable.isSecret,
      source: variable.source,
      category: normalizeCategory(variable.category),
      scope: variable.scope,
      scopeLabel: variable.scopeLabel,
      branchPattern: variable.branchPattern,
      originSummary: variable.originSummary
    })) ?? [];

  const filteredVars =
    categoryFilter === "all"
      ? vars
      : vars.filter((variable) => variable.category === categoryFilter);
  const filteredResolvedVars =
    categoryFilter === "all"
      ? resolvedVars
      : resolvedVars.filter((variable) => variable.category === categoryFilter);

  const runtimeBaseServiceOverrides = vars.filter(
    (variable) =>
      variable.scope === "service" &&
      variable.category === "runtime" &&
      variable.branchPattern === null
  );
  const previewServiceOverrides = vars.filter(
    (variable) => variable.scope === "service" && variable.branchPattern !== null
  );

  function toggleResolvedReveal(key: string) {
    setRevealedResolvedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const handleSaveRaw = useCallback(async () => {
    if (!environmentId) {
      return;
    }

    const lines = rawText.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
    await Promise.all(
      lines.map(async (line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
          return;
        }

        const key = line
          .slice(0, separatorIndex)
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, "_");
        const value = line.slice(separatorIndex + 1).trim();
        if (!key || !/^[A-Z_][A-Z0-9_]*$/.test(key)) {
          return;
        }

        await upsertMutation.mutateAsync({
          environmentId,
          serviceId,
          scope: "service",
          key,
          value: value || " ",
          isSecret: false,
          category: "runtime"
        });
      })
    );
  }, [environmentId, rawText, serviceId, upsertMutation]);

  const handleSaveBuildConfig = useCallback(() => {
    setSavedBuildArgs(buildArgs);
    setSavedBuildSecrets(buildSecrets);
  }, [buildArgs, buildSecrets]);

  function handleEnterRawMode() {
    setMode("raw");
    setRawText(
      runtimeBaseServiceOverrides
        .map((variable) =>
          variable.isSecret
            ? `# ${variable.key}=[secret]`
            : `${variable.key}=${variable.value === "[secret]" ? "" : variable.value}`
        )
        .join("\n")
    );
  }

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (mode === "raw") {
          void handleSaveRaw();
        } else if (hasUnsavedChanges) {
          handleSaveBuildConfig();
        }
      }
    },
    [handleSaveBuildConfig, handleSaveRaw, hasUnsavedChanges, mode]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (envQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    );
  }

  if (!environmentId) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-12 text-center text-muted-foreground">
          No environment linked to this service. Environment variables require an environment
          context.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid={`service-environment-tab-${serviceId}`}>
      <Card className="shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Inheritance model</p>
            <p className="text-sm text-muted-foreground">
              Shared environment values are the base layer. Service overrides win for this service,
              and preview-scoped entries win only when the branch pattern matches the preview.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div
              className="rounded-xl border p-4"
              data-testid={`service-envvar-summary-layers-${serviceId}`}
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Layers</p>
              <p className="mt-1 text-2xl font-semibold">
                {envQuery.data?.summary.totalVariables ?? 0}
              </p>
            </div>
            <div
              className="rounded-xl border p-4"
              data-testid={`service-envvar-summary-resolved-${serviceId}`}
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Resolved</p>
              <p className="mt-1 text-2xl font-semibold">
                {envQuery.data?.summary.resolvedVariables ?? 0}
              </p>
            </div>
            <div
              className="rounded-xl border p-4"
              data-testid={`service-envvar-summary-service-${serviceId}`}
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Service overrides
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {envQuery.data?.summary.serviceOverrides ?? 0}
              </p>
            </div>
            <div
              className="rounded-xl border p-4"
              data-testid={`service-envvar-summary-preview-${serviceId}`}
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Preview overrides
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {envQuery.data?.summary.previewOverrides ?? 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Effective values for this service</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredResolvedVars.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid={`service-envvar-resolved-empty-${serviceId}`}
            >
              No effective values are resolved for this service yet.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredResolvedVars.map((variable) => (
                <div
                  key={`${variable.key}-${variable.branchPattern ?? "base"}`}
                  className="rounded-xl border p-3"
                  data-testid={`service-envvar-resolved-${serviceId}-${variable.key}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">{variable.key}</span>
                      <Badge variant="outline">{variable.category}</Badge>
                      <Badge variant="outline">{variable.scopeLabel}</Badge>
                      {variable.isSecret ? <Badge variant="outline">Secret</Badge> : null}
                      {variable.source === "1password" ? (
                        <Badge variant="outline">1Password</Badge>
                      ) : null}
                      {variable.branchPattern ? (
                        <Badge variant="outline">{variable.branchPattern}</Badge>
                      ) : null}
                    </div>
                    {variable.isSecret && variable.displayValue !== "[secret]" ? (
                      <Button
                        data-testid={`service-envvar-resolved-reveal-${serviceId}-${variable.key}`}
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleResolvedReveal(variable.key)}
                        aria-label={
                          revealedResolvedKeys.has(variable.key)
                            ? "Hide resolved secret"
                            : "Reveal resolved secret"
                        }
                      >
                        {revealedResolvedKeys.has(variable.key) ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </Button>
                    ) : null}
                  </div>
                  <p
                    className="mt-2 font-mono text-sm text-muted-foreground"
                    data-testid={`service-envvar-resolved-value-${serviceId}-${variable.key}`}
                  >
                    {variable.isSecret && !revealedResolvedKeys.has(variable.key)
                      ? "[secret]"
                      : variable.displayValue}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">{variable.originSummary}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">
            {filteredVars.length} layer{filteredVars.length !== 1 ? "s" : ""}
            {categoryFilter !== "all" ? <span className="ml-1">({categoryFilter})</span> : null}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border text-xs">
            {(["all", "runtime", "build"] as const).map((category) => (
              <button
                key={category}
                data-testid={`service-envvar-filter-${serviceId}-${category}`}
                onClick={() => setCategoryFilter(category)}
                className={`px-2.5 py-1 transition-colors ${
                  categoryFilter === category
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                } ${category === "all" ? "rounded-l-md" : category === "build" ? "rounded-r-md" : ""}`}
              >
                {category === "all" ? "All" : category.charAt(0).toUpperCase() + category.slice(1)}
              </button>
            ))}
          </div>
          <Button
            data-testid={`service-envvar-mode-table-${serviceId}`}
            size="sm"
            variant={mode === "table" ? "default" : "outline"}
            onClick={() => setMode("table")}
          >
            <ArrowDownUp size={14} className="mr-1" />
            Table
          </Button>
          <Button
            data-testid={`service-envvar-mode-raw-${serviceId}`}
            size="sm"
            variant={mode === "raw" ? "default" : "outline"}
            onClick={handleEnterRawMode}
          >
            <FileText size={14} className="mr-1" />
            Raw
          </Button>
        </div>
      </div>

      {mode === "table" ? (
        <EnvVarTable
          vars={filteredVars}
          environmentId={environmentId}
          serviceId={serviceId}
          onUpsert={(data) => upsertMutation.mutate(data)}
          onDelete={(data) => deleteMutation.mutate(data)}
          isUpsertPending={upsertMutation.isPending}
          isDeletePending={deleteMutation.isPending}
        />
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              The raw editor writes base runtime service overrides only. Shared environment values
              stay unchanged unless you edit them from the environment management surface.
            </p>
            {previewServiceOverrides.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Preview-only overrides stay out of raw mode so saving here does not flatten
                branch-specific behavior into the base service configuration.
              </p>
            ) : null}
          </div>
          <RawEnvEditor
            rawText={rawText}
            onRawTextChange={setRawText}
            onSave={() => void handleSaveRaw()}
            isPending={upsertMutation.isPending}
          />
        </div>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wrench size={14} />
              Build Configuration
            </CardTitle>
            {hasUnsavedChanges ? (
              <Badge variant="outline" className="border-amber-500 text-xs text-amber-500">
                Unsaved changes
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label
              className="mb-1.5 block text-sm font-medium"
              htmlFor={`service-build-args-${serviceId}`}
            >
              Build-time Arguments
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Arguments available only at build-time (ARG in Dockerfile). One per line: KEY=value
            </p>
            <textarea
              data-testid={`service-build-args-${serviceId}`}
              id={`service-build-args-${serviceId}`}
              aria-label="Build-time Arguments"
              name={`service-build-args-${serviceId}`}
              className="min-h-[80px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={"NPM_TOKEN=xyz\nNODE_ENV=production"}
              value={buildArgs}
              onChange={(event) => setBuildArgs(event.target.value)}
            />
          </div>
          <div>
            <label
              className="mb-1.5 block text-sm font-medium"
              htmlFor={`service-build-secrets-${serviceId}`}
            >
              Build-time Secrets
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Secrets available only at build-time via --mount=type=secret. Never stored in image
              layers.
            </p>
            <textarea
              data-testid={`service-build-secrets-${serviceId}`}
              id={`service-build-secrets-${serviceId}`}
              aria-label="Build-time Secrets"
              name={`service-build-secrets-${serviceId}`}
              className="min-h-[80px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={"DB_PASSWORD=secret123\nAPI_KEY=sk-..."}
              value={buildSecrets}
              onChange={(event) => setBuildSecrets(event.target.value)}
            />
          </div>
          {hasUnsavedChanges ? (
            <div className="flex justify-end gap-2">
              <Button
                data-testid={`service-build-cancel-${serviceId}`}
                size="sm"
                variant="outline"
                onClick={() => {
                  setBuildArgs(savedBuildArgs);
                  setBuildSecrets(savedBuildSecrets);
                }}
              >
                Cancel
              </Button>
              <Button
                data-testid={`service-build-save-${serviceId}`}
                size="sm"
                onClick={handleSaveBuildConfig}
              >
                <Save size={14} className="mr-1" />
                Save (⌘S)
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
