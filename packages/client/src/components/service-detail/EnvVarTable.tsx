import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Pencil, Plus, Save, Trash2 } from "lucide-react";

interface EnvVar {
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

interface EnvVarTableProps {
  vars: EnvVar[];
  environmentId: string;
  serviceId: string;
  onUpsert: (data: {
    environmentId: string;
    serviceId: string;
    scope: "service";
    key: string;
    value: string;
    isSecret: boolean;
    category: "runtime" | "build";
    branchPattern?: string;
  }) => void;
  onDelete: (data: {
    environmentId: string;
    serviceId: string;
    scope: "service";
    key: string;
    branchPattern?: string | null;
  }) => void;
  isUpsertPending: boolean;
  isDeletePending: boolean;
}

function normalizeBranchPattern(value: string) {
  return value.trim();
}

export function EnvVarTable({
  vars,
  environmentId,
  serviceId,
  onUpsert,
  onDelete,
  isUpsertPending,
  isDeletePending
}: EnvVarTableProps) {
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newBranchPattern, setNewBranchPattern] = useState("");
  const [newCategory, setNewCategory] = useState<"runtime" | "build">("runtime");
  const [newIsSecret, setNewIsSecret] = useState(false);

  function toggleReveal(key: string) {
    setRevealedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleCreateOverride() {
    const normalizedKey = newKey.trim();
    const branchPattern = normalizeBranchPattern(newBranchPattern);
    if (!normalizedKey || !/^[A-Z_][A-Z0-9_]*$/.test(normalizedKey)) {
      return;
    }

    onUpsert({
      environmentId,
      serviceId,
      scope: "service",
      key: normalizedKey,
      value: newValue || " ",
      isSecret: newIsSecret,
      category: newCategory,
      ...(branchPattern ? { branchPattern } : {})
    });

    setNewKey("");
    setNewValue("");
    setNewBranchPattern("");
    setNewCategory("runtime");
    setNewIsSecret(false);
  }

  return (
    <Card data-testid={`service-envvar-table-${serviceId}`}>
      <CardContent className="space-y-4 pt-4">
        <div className="space-y-3 rounded-xl border border-dashed p-4">
          <div>
            <p className="text-sm font-medium text-foreground">Add service override</p>
            <p className="text-xs text-muted-foreground">
              Service-scoped values override the shared environment only for this service. Add a
              branch pattern to make the override preview-only.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <label className="space-y-1 text-sm text-muted-foreground">
              <span>Key</span>
              <Input
                data-testid={`service-envvar-new-key-${serviceId}`}
                aria-label="Override key"
                name={`service-envvar-new-key-${serviceId}`}
                placeholder="KEY"
                value={newKey}
                onChange={(event) =>
                  setNewKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
                }
                className="font-mono text-sm"
              />
            </label>
            <label className="space-y-1 text-sm text-muted-foreground">
              <span>Value</span>
              <Input
                data-testid={`service-envvar-new-value-${serviceId}`}
                aria-label="Override value"
                name={`service-envvar-new-value-${serviceId}`}
                placeholder="value"
                value={newValue}
                onChange={(event) => setNewValue(event.target.value)}
                className="font-mono text-sm"
              />
            </label>
            <label className="space-y-1 text-sm text-muted-foreground md:col-span-2">
              <span>Preview branch pattern</span>
              <Input
                data-testid={`service-envvar-new-branch-${serviceId}`}
                aria-label="Preview branch pattern"
                name={`service-envvar-new-branch-${serviceId}`}
                placeholder="Optional branch pattern, e.g. preview/*"
                value={newBranchPattern}
                onChange={(event) => setNewBranchPattern(event.target.value)}
                className="font-mono text-sm"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-muted-foreground">
              Category
              <select
                data-testid={`service-envvar-new-category-${serviceId}`}
                aria-label="Override category"
                name={`service-envvar-new-category-${serviceId}`}
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value as "runtime" | "build")}
                className="ml-2 rounded-md border bg-background px-2 py-1 text-sm text-foreground"
              >
                <option value="runtime">runtime</option>
                <option value="build">build</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                data-testid={`service-envvar-new-secret-${serviceId}`}
                aria-label="Secret override"
                name={`service-envvar-new-secret-${serviceId}`}
                checked={newIsSecret}
                onChange={(event) => setNewIsSecret(event.target.checked)}
                type="checkbox"
              />
              Secret
            </label>
            <Button
              data-testid={`service-envvar-add-${serviceId}`}
              size="sm"
              onClick={handleCreateOverride}
              disabled={!newKey.trim() || isUpsertPending}
            >
              <Plus size={14} className="mr-1" />
              Add override
            </Button>
          </div>
        </div>

        {vars.length === 0 ? (
          <p
            className="py-4 text-center text-sm text-muted-foreground"
            data-testid={`service-envvar-empty-${serviceId}`}
          >
            No environment values are configured for this service yet.
          </p>
        ) : (
          <div className="space-y-3">
            {vars.map((variable) => {
              const canEdit = variable.scope === "service";
              const canRevealSecret = variable.isSecret && variable.value !== "[secret]";
              const showValue =
                variable.isSecret && !revealedKeys.has(variable.id) ? "[secret]" : variable.value;

              return (
                <div
                  key={variable.id}
                  className="rounded-xl border p-3"
                  data-testid={`service-envvar-row-${variable.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
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
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid={`service-envvar-origin-${variable.id}`}
                      >
                        {variable.originSummary}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {canRevealSecret ? (
                        <Button
                          data-testid={`service-envvar-reveal-${variable.id}`}
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleReveal(variable.id)}
                          aria-label={
                            revealedKeys.has(variable.id) ? "Hide secret" : "Reveal secret"
                          }
                        >
                          {revealedKeys.has(variable.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <>
                          <Button
                            data-testid={`service-envvar-edit-${variable.id}`}
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(variable.id);
                              setEditValue(variable.isSecret ? "" : variable.value);
                            }}
                            aria-label="Edit override"
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            data-testid={`service-envvar-delete-${variable.id}`}
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() =>
                              onDelete({
                                environmentId,
                                serviceId,
                                scope: "service",
                                key: variable.key,
                                branchPattern: variable.branchPattern
                              })
                            }
                            disabled={isDeletePending}
                            aria-label="Delete override"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {editingId === variable.id ? (
                    <div className="mt-3 flex items-center gap-2">
                      <Input
                        data-testid={`service-envvar-edit-value-${variable.id}`}
                        aria-label={`Override value for ${variable.key}`}
                        name={`service-envvar-edit-value-${variable.id}`}
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        className="font-mono text-sm"
                        placeholder={variable.isSecret ? "Enter a new secret value" : undefined}
                        autoFocus
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            if (variable.isSecret && editValue.trim().length === 0) {
                              return;
                            }
                            onUpsert({
                              environmentId,
                              serviceId,
                              scope: "service",
                              key: variable.key,
                              value: variable.isSecret ? editValue.trim() : editValue || " ",
                              isSecret: variable.isSecret,
                              category: variable.category,
                              ...(variable.branchPattern
                                ? { branchPattern: variable.branchPattern }
                                : {})
                            });
                            setEditingId(null);
                          }
                          if (event.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                      />
                      <Button
                        data-testid={`service-envvar-save-${variable.id}`}
                        size="sm"
                        disabled={variable.isSecret && editValue.trim().length === 0}
                        onClick={() => {
                          onUpsert({
                            environmentId,
                            serviceId,
                            scope: "service",
                            key: variable.key,
                            value: variable.isSecret ? editValue.trim() : editValue || " ",
                            isSecret: variable.isSecret,
                            category: variable.category,
                            ...(variable.branchPattern
                              ? { branchPattern: variable.branchPattern }
                              : {})
                          });
                          setEditingId(null);
                        }}
                      >
                        <Save size={14} className="mr-1" />
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <p
                        className="font-mono text-sm text-muted-foreground"
                        data-testid={`service-envvar-value-${variable.id}`}
                      >
                        {showValue}
                      </p>
                      {canEdit ? null : (
                        <p
                          className="text-xs text-muted-foreground"
                          data-testid={`service-envvar-shared-note-${variable.id}`}
                        >
                          Shared environment values are read here so you can see inheritance. Add a
                          service override above if this service needs different behavior.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
