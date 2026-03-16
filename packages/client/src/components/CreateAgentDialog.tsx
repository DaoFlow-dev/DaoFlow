import { useState } from "react";
import { trpc } from "../lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const scopeGroups = [
  {
    label: "Read",
    scopes: [
      "server:read",
      "deploy:read",
      "service:read",
      "env:read",
      "logs:read",
      "events:read",
      "backup:read",
      "diagnostics:read"
    ]
  },
  {
    label: "Planning",
    scopes: ["approvals:create"]
  },
  {
    label: "Command",
    scopes: ["deploy:start", "deploy:cancel", "deploy:rollback", "backup:run"]
  }
] as const;

export default function CreateAgentDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const createAgent = trpc.createAgent.useMutation({
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setDescription("");
      setSelected(new Set());
    }
  });

  function toggleScope(scope: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function selectAll(scopes: readonly string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = scopes.every((s) => next.has(s));
      if (allSelected) {
        scopes.forEach((s) => next.delete(s));
      } else {
        scopes.forEach((s) => next.add(s));
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || selected.size === 0) return;
    createAgent.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      scopes: [...selected]
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Agent</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. deploy-bot, monitoring-agent"
              required
            />
          </div>
          <div>
            <Label htmlFor="agent-desc">Description (optional)</Label>
            <Input
              id="agent-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent does"
            />
          </div>

          <div>
            <Label>Permissions</Label>
            <div className="mt-2 space-y-3">
              {scopeGroups.map((group) => (
                <div key={group.label}>
                  <button
                    type="button"
                    className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 hover:text-foreground cursor-pointer"
                    onClick={() => selectAll(group.scopes)}
                  >
                    {group.label} — Select All
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {group.scopes.map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => toggleScope(scope)}
                        className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                          selected.has(scope)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-input hover:bg-muted"
                        }`}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createAgent.isPending || !name.trim() || selected.size === 0}
            >
              {createAgent.isPending ? "Creating…" : `Create (${selected.size} scopes)`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
