import { useState } from "react";
import { Eye, EyeOff, Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

interface ProjectEnvironmentDefaultsPanelProps {
  projectId: string;
}

export function ProjectEnvironmentDefaultsPanel({
  projectId
}: ProjectEnvironmentDefaultsPanelProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [isSecret, setIsSecret] = useState(false);
  const [category, setCategory] = useState<"runtime" | "build">("runtime");
  const [revealedSecretIds, setRevealedSecretIds] = useState<Set<string>>(new Set());
  const defaultsQuery = trpc.environmentVariables.useQuery({ projectId, limit: 100 });
  const upsert = trpc.upsertEnvironmentVariable.useMutation({
    onSuccess: () => void defaultsQuery.refetch()
  });
  const remove = trpc.deleteEnvironmentVariable.useMutation({
    onSuccess: () => void defaultsQuery.refetch()
  });
  const defaults =
    defaultsQuery.data?.variables.filter((variable) => variable.scope === "project") ?? [];

  function saveDefault() {
    const normalizedKey = key.trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(normalizedKey) || value.length === 0) {
      return;
    }

    upsert.mutate({
      projectId,
      scope: "project",
      key: normalizedKey,
      value,
      isSecret,
      category
    });
    setKey("");
    setValue("");
    setIsSecret(false);
    setCategory("runtime");
  }

  return (
    <Card className="shadow-sm" data-testid={`project-defaults-${projectId}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Shared project defaults</CardTitle>
        <p
          className="text-sm text-muted-foreground"
          data-testid={`project-defaults-help-${projectId}`}
        >
          These values apply to every environment in this project until an environment, service, or
          preview override wins. Secret values stay masked unless you have permission to read them.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-xl border border-dashed p-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-muted-foreground">
            <span>Key</span>
            <Input
              data-testid={`project-default-key-${projectId}`}
              aria-label="Project default key"
              value={key}
              onChange={(event) =>
                setKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
              }
              placeholder="APP_URL"
              className="font-mono text-sm"
            />
          </label>
          <label className="space-y-1 text-sm text-muted-foreground">
            <span>Value</span>
            <Input
              data-testid={`project-default-value-${projectId}`}
              aria-label="Project default value"
              type={isSecret ? "password" : "text"}
              autoComplete={isSecret ? "new-password" : undefined}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://example.com"
              className="font-mono text-sm"
            />
          </label>
          <label className="text-sm text-muted-foreground">
            Category
            <select
              data-testid={`project-default-category-${projectId}`}
              aria-label="Project default category"
              value={category}
              onChange={(event) => setCategory(event.target.value as "runtime" | "build")}
              className="ml-2 rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="runtime">runtime</option>
              <option value="build">build</option>
            </select>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                data-testid={`project-default-secret-${projectId}`}
                aria-label="Project default secret"
                checked={isSecret}
                onChange={(event) => setIsSecret(event.target.checked)}
                type="checkbox"
              />
              Secret
            </label>
            <Button
              data-testid={`project-default-save-${projectId}`}
              size="sm"
              onClick={saveDefault}
              disabled={!key.trim() || value.length === 0 || upsert.isPending}
            >
              {defaults.some((variable) => variable.key === key.trim().toUpperCase()) ? (
                <Save size={14} className="mr-1" />
              ) : (
                <Plus size={14} className="mr-1" />
              )}
              Save default
            </Button>
          </div>
        </div>

        {defaultsQuery.isLoading ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`project-defaults-loading-${projectId}`}
          >
            Loading project defaults…
          </p>
        ) : defaults.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`project-defaults-empty-${projectId}`}
          >
            No project defaults are configured yet.
          </p>
        ) : (
          <div className="space-y-3">
            {defaults.map((variable) => {
              const isRevealed = revealedSecretIds.has(variable.id);
              return (
                <article
                  key={variable.id}
                  className="rounded-xl border p-3"
                  data-testid={`project-default-row-${variable.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium">{variable.key}</span>
                        <Badge variant="outline">{variable.originSummary}</Badge>
                        <Badge variant="outline">r{variable.revision}</Badge>
                        <Badge variant="outline">{variable.category}</Badge>
                        {variable.isSecret ? <Badge variant="outline">Secret</Badge> : null}
                      </div>
                      <p
                        className="font-mono text-sm text-muted-foreground"
                        data-testid={`project-default-value-${variable.id}`}
                      >
                        {variable.isSecret && !isRevealed ? (
                          <EyeOff size={14} className="mr-1 inline" />
                        ) : null}
                        {variable.isSecret && !isRevealed ? "[secret]" : variable.displayValue}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {variable.isSecret ? (
                        <Button
                          data-testid={`project-default-reveal-${variable.id}`}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setRevealedSecretIds((previous) => {
                              const next = new Set(previous);
                              if (next.has(variable.id)) {
                                next.delete(variable.id);
                              } else {
                                next.add(variable.id);
                              }
                              return next;
                            })
                          }
                          aria-label={
                            isRevealed ? `Hide ${variable.key}` : `Reveal ${variable.key}`
                          }
                        >
                          {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Button>
                      ) : null}
                      <Button
                        data-testid={`project-default-use-${variable.id}`}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setKey(variable.key);
                          setValue(variable.isSecret ? "" : variable.displayValue);
                          setIsSecret(variable.isSecret);
                          setCategory(variable.category);
                        }}
                      >
                        Update
                      </Button>
                      <Button
                        data-testid={`project-default-delete-${variable.id}`}
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate({ projectId, scope: "project", key: variable.key })
                        }
                        aria-label={`Delete ${variable.key}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {upsert.error?.message || remove.error?.message ? (
          <p
            className="text-sm text-destructive"
            data-testid={`project-defaults-error-${projectId}`}
          >
            {upsert.error?.message ?? remove.error?.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
