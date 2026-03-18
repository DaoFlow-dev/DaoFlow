import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowDownUp, FileText, Save, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EnvVarTable } from "./EnvVarTable";
import { RawEnvEditor } from "./RawEnvEditor";

interface EnvironmentTabProps {
  serviceId: string;
  environmentId?: string;
}

interface EnvVar {
  id: string;
  key: string;
  value: string;
  scope?: string;
  isSecret: boolean;
  source?: string;
  category?: "runtime" | "build";
}

function normalizeCategory(category: string): "runtime" | "build" {
  return category === "build" ? "build" : "runtime";
}

export default function EnvironmentTab({
  serviceId: _serviceId,
  environmentId
}: EnvironmentTabProps) {
  const [mode, setMode] = useState<"table" | "raw">("table");
  const [rawText, setRawText] = useState("");
  const [buildArgs, setBuildArgs] = useState("");
  const [buildSecrets, setBuildSecrets] = useState("");
  const [savedBuildArgs, setSavedBuildArgs] = useState("");
  const [savedBuildSecrets, setSavedBuildSecrets] = useState("");

  const hasUnsavedChanges = buildArgs !== savedBuildArgs || buildSecrets !== savedBuildSecrets;

  const envQuery = trpc.environmentVariables.useQuery(
    { environmentId: environmentId, limit: 100 },
    { enabled: !!environmentId }
  );

  const upsertMutation = trpc.upsertEnvironmentVariable.useMutation({
    onSuccess: () => void envQuery.refetch()
  });

  const deleteMutation = trpc.deleteEnvironmentVariable.useMutation({
    onSuccess: () => void envQuery.refetch()
  });

  const vars: EnvVar[] =
    envQuery.data?.variables.map((variable) => ({
      id: variable.id,
      key: variable.key,
      value: variable.displayValue,
      isSecret: variable.isSecret,
      source: variable.source,
      category: normalizeCategory(variable.category)
    })) ?? [];

  const handleSaveRaw = useCallback(() => {
    if (!environmentId) return;
    const lines = rawText.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    for (const line of lines) {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line
        .slice(0, eqIdx)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "_");
      const value = line.slice(eqIdx + 1).trim();
      if (key && /^[A-Z_][A-Z0-9_]*$/.test(key)) {
        upsertMutation.mutate({
          environmentId,
          key,
          value: value || " ",
          isSecret: false,
          category: "runtime" as const
        });
      }
    }
  }, [environmentId, rawText, upsertMutation]);

  const handleSaveBuildConfig = useCallback(() => {
    setSavedBuildArgs(buildArgs);
    setSavedBuildSecrets(buildSecrets);
  }, [buildArgs, buildSecrets]);

  function handleEnterRawMode() {
    setMode("raw");
    setRawText(
      vars
        .map((variable) =>
          variable.isSecret ? `# ${variable.key}=[secret]` : `${variable.key}=${variable.value}`
        )
        .join("\n")
    );
  }

  // Cmd+S keyboard shortcut
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (mode === "raw") {
          handleSaveRaw();
        } else if (hasUnsavedChanges) {
          handleSaveBuildConfig();
        }
      }
    },
    [mode, handleSaveRaw, hasUnsavedChanges, handleSaveBuildConfig]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (envQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!environmentId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No environment linked to this service. Environment variables require an environment
          context.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {vars.length} variable{vars.length !== 1 ? "s" : ""}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={mode === "table" ? "default" : "outline"}
            onClick={() => setMode("table")}
          >
            <ArrowDownUp size={14} className="mr-1" />
            Table
          </Button>
          <Button
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
          vars={vars}
          environmentId={environmentId}
          onUpsert={(data) => upsertMutation.mutate(data)}
          onDelete={(data) => deleteMutation.mutate(data)}
          isUpsertPending={upsertMutation.isPending}
        />
      ) : (
        <RawEnvEditor
          rawText={rawText}
          onRawTextChange={setRawText}
          onSave={handleSaveRaw}
          isPending={upsertMutation.isPending}
        />
      )}

      {/* Build Args & Secrets (Dokploy pattern) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wrench size={14} />
              Build Configuration
            </CardTitle>
            {hasUnsavedChanges && (
              <Badge variant="outline" className="text-xs text-amber-500 border-amber-500">
                Unsaved changes
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Build-time Arguments</label>
            <p className="text-xs text-muted-foreground mb-2">
              Arguments available only at build-time (ARG in Dockerfile). One per line: KEY=value
            </p>
            <textarea
              className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              placeholder={"NPM_TOKEN=xyz\nNODE_ENV=production"}
              value={buildArgs}
              onChange={(e) => setBuildArgs(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Build-time Secrets</label>
            <p className="text-xs text-muted-foreground mb-2">
              Secrets available only at build-time via --mount=type=secret. Never stored in image
              layers.
            </p>
            <textarea
              className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              placeholder={"DB_PASSWORD=secret123\nAPI_KEY=sk-..."}
              value={buildSecrets}
              onChange={(e) => setBuildSecrets(e.target.value)}
            />
          </div>
          {hasUnsavedChanges && (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBuildArgs(savedBuildArgs);
                  setBuildSecrets(savedBuildSecrets);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveBuildConfig}>
                <Save size={14} className="mr-1" />
                Save (⌘S)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
