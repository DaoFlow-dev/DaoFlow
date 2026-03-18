import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownUp, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EnvVarTable } from "./EnvVarTable";
import { RawEnvEditor } from "./RawEnvEditor";

interface EnvironmentTabProps {
  serviceId: string;
  environmentId?: string;
}

interface EnvVar {
  id: number;
  key: string;
  value: string;
  scope?: string;
  isSecret: boolean;
  source?: string;
  category?: string;
}

export default function EnvironmentTab({
  serviceId: _serviceId,
  environmentId
}: EnvironmentTabProps) {
  const [mode, setMode] = useState<"table" | "raw">("table");
  const [rawText, setRawText] = useState("");

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

  const rawData = envQuery.data;
  const vars: EnvVar[] = Array.isArray(rawData) ? (rawData as EnvVar[]) : [];

  function handleSaveRaw() {
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
  }

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
            onClick={() => {
              setMode("raw");
              setRawText(vars.map((v) => `${v.key}=${v.value}`).join("\n"));
            }}
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
    </div>
  );
}
