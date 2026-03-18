import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Eye, EyeOff, Save, FileText, Pencil, ArrowDownUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [rawText, setRawText] = useState("");

  const envQuery = trpc.environmentVariables.useQuery(
    { environmentId: environmentId, limit: 100 },
    { enabled: !!environmentId }
  );

  const upsertMutation = trpc.upsertEnvironmentVariable.useMutation({
    onSuccess: () => {
      void envQuery.refetch();
      setNewKey("");
      setNewValue("");
      setEditingId(null);
    }
  });

  const deleteMutation = trpc.deleteEnvironmentVariable.useMutation({
    onSuccess: () => void envQuery.refetch()
  });

  const rawData = envQuery.data;
  const vars: EnvVar[] = Array.isArray(rawData) ? (rawData as EnvVar[]) : [];

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
        <Card>
          <CardContent className="pt-4">
            {/* Add new var */}
            <div className="flex items-center gap-2 mb-4 pb-4 border-b">
              <Input
                placeholder="KEY"
                value={newKey}
                onChange={(e) =>
                  setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
                }
                className="h-8 font-mono text-sm flex-1"
              />
              <Input
                placeholder="value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="h-8 font-mono text-sm flex-[2]"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (newKey.trim() && /^[A-Z_][A-Z0-9_]*$/.test(newKey.trim())) {
                    upsertMutation.mutate({
                      environmentId,
                      key: newKey.trim(),
                      value: newValue || " ",
                      isSecret: false,
                      category: "runtime" as const
                    });
                  }
                }}
                disabled={!newKey.trim() || upsertMutation.isPending}
              >
                <Plus size={14} className="mr-1" />
                Add
              </Button>
            </div>

            {/* Var list */}
            {vars.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No environment variables configured.
              </p>
            ) : (
              <div className="space-y-1">
                {vars.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 group"
                  >
                    <span className="font-mono text-sm font-medium min-w-[120px]">{v.key}</span>
                    <span className="text-muted-foreground">=</span>

                    {editingId === v.id ? (
                      <>
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-7 font-mono text-sm flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              upsertMutation.mutate({
                                environmentId,
                                key: v.key,
                                value: editValue || " ",
                                isSecret: v.isSecret,
                                category: "runtime" as const
                              });
                            } else if (e.key === "Escape") {
                              setEditingId(null);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            upsertMutation.mutate({
                              environmentId,
                              key: v.key,
                              value: editValue || " ",
                              isSecret: v.isSecret,
                              category: "runtime" as const
                            });
                          }}
                        >
                          <Save size={14} />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-sm text-muted-foreground flex-1 truncate">
                          {revealedKeys.has(v.key) ? v.value : "••••••••"}
                        </span>

                        {v.category && (
                          <Badge variant="outline" className="text-xs">
                            {v.category}
                          </Badge>
                        )}

                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleReveal(v.key)}
                            title={revealedKeys.has(v.key) ? "Hide" : "Reveal"}
                          >
                            {revealedKeys.has(v.key) ? <EyeOff size={14} /> : <Eye size={14} />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(v.id);
                              setEditValue(v.value);
                            }}
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() =>
                              deleteMutation.mutate({
                                environmentId,
                                key: v.key
                              })
                            }
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Raw .env editor */
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Raw Editor — one KEY=value per line, # for comments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full h-64 p-3 font-mono text-sm bg-[#0d1117] text-gray-300 rounded-lg border border-white/10 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              spellCheck={false}
            />
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={handleSaveRaw} disabled={upsertMutation.isPending}>
                <Save size={14} className="mr-1" />
                Save All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
