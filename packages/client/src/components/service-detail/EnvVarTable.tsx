import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Eye, EyeOff, Save, Pencil } from "lucide-react";
import { useState } from "react";

interface EnvVar {
  id: string;
  key: string;
  value: string;
  scope?: string;
  isSecret: boolean;
  source?: string;
  category?: "runtime" | "build";
}

interface EnvVarTableProps {
  vars: EnvVar[];
  environmentId: string;
  onUpsert: (data: {
    environmentId: string;
    key: string;
    value: string;
    isSecret: boolean;
    category: "runtime" | "build";
  }) => void;
  onDelete: (data: { environmentId: string; key: string }) => void;
  isUpsertPending: boolean;
}

export function EnvVarTable({
  vars,
  environmentId,
  onUpsert,
  onDelete,
  isUpsertPending
}: EnvVarTableProps) {
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  function getVariableCategory(variable: EnvVar): "runtime" | "build" {
    return variable.category === "build" ? "build" : "runtime";
  }

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardContent className="pt-4">
        {/* Add new var */}
        <div className="flex items-center gap-2 mb-4 pb-4 border-b">
          <Input
            placeholder="KEY"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
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
                onUpsert({
                  environmentId,
                  key: newKey.trim(),
                  value: newValue || " ",
                  isSecret: false,
                  category: "runtime" as const
                });
                setNewKey("");
                setNewValue("");
              }
            }}
            disabled={!newKey.trim() || isUpsertPending}
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
                      placeholder={v.isSecret ? "Enter a new secret value" : undefined}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (v.isSecret && editValue.trim().length === 0) {
                            return;
                          }
                          onUpsert({
                            environmentId,
                            key: v.key,
                            value: v.isSecret ? editValue.trim() : editValue || " ",
                            isSecret: v.isSecret,
                            category: getVariableCategory(v)
                          });
                          setEditingId(null);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={v.isSecret && editValue.trim().length === 0}
                      onClick={() => {
                        onUpsert({
                          environmentId,
                          key: v.key,
                          value: v.isSecret ? editValue.trim() : editValue || " ",
                          isSecret: v.isSecret,
                          category: getVariableCategory(v)
                        });
                        setEditingId(null);
                      }}
                    >
                      <Save size={14} />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-sm text-muted-foreground flex-1 truncate">
                      {v.isSecret ? "[secret]" : revealedKeys.has(v.key) ? v.value : "••••••••"}
                    </span>

                    {v.category && (
                      <Badge variant="outline" className="text-xs">
                        {v.category}
                      </Badge>
                    )}

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!v.isSecret ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleReveal(v.key)}
                          title={revealedKeys.has(v.key) ? "Hide" : "Reveal"}
                        >
                          {revealedKeys.has(v.key) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(v.id);
                          setEditValue(v.isSecret ? "" : v.value);
                        }}
                        title={v.isSecret ? "Replace secret" : "Edit"}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => onDelete({ environmentId, key: v.key })}
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
  );
}
