import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Eye, EyeOff, Save, Pencil } from "lucide-react";
import { useState } from "react";

interface EnvVar {
  id: number;
  key: string;
  value: string;
  scope?: string;
  isSecret: boolean;
  source?: string;
  category?: string;
}

interface EnvVarTableProps {
  vars: EnvVar[];
  environmentId: string;
  onUpsert: (data: {
    environmentId: string;
    key: string;
    value: string;
    isSecret: boolean;
    category: "runtime";
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

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
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onUpsert({
                            environmentId,
                            key: v.key,
                            value: editValue || " ",
                            isSecret: v.isSecret,
                            category: "runtime" as const
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
                      onClick={() => {
                        onUpsert({
                          environmentId,
                          key: v.key,
                          value: editValue || " ",
                          isSecret: v.isSecret,
                          category: "runtime" as const
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
