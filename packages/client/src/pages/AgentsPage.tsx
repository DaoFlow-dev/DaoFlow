import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Plus, Copy, Check, Key, Shield } from "lucide-react";
import CreateAgentDialog from "@/components/CreateAgentDialog";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";

export default function AgentsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const agents = trpc.agents.useQuery();

  function handleCopyPrompt(agentName: string, scopes: string) {
    // Generate a basic setup prompt for clipboard
    const prompt = `# DaoFlow Agent Setup — ${agentName}

You are configured as an agent on a DaoFlow instance.

## Granted Scopes
${scopes || "read-only defaults"}

## Safety Constraints
- You default to read-only access
- Destructive operations require elevated scopes  
- All actions are audited with your agent identity
- Use --dry-run before executing mutations

## Available Commands
daoflow whoami --json
daoflow capabilities --json
daoflow status --json
daoflow deployments --json
daoflow logs --json`;

    void navigator.clipboard.writeText(prompt).then(() => {
      setCopiedId(agentName);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot size={24} /> Agents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure AI agent access with scoped permissions
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1" /> New Agent
        </Button>
      </div>

      {agents.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : agents.data?.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Bot size={32} className="mx-auto mb-3 opacity-40" />
            <p>No agents configured yet.</p>
            <p className="text-xs mt-1">
              Create an agent principal with scoped permissions for AI systems.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {agents.data?.map((agent) => (
            <Card key={agent.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot size={16} />
                    {agent.name}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={getInventoryBadgeVariant(agent.status)}>{agent.status}</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyPrompt(agent.name, agent.defaultScopes ?? "")}
                    >
                      {copiedId === agent.name ? (
                        <Check size={14} className="mr-1" />
                      ) : (
                        <Copy size={14} className="mr-1" />
                      )}
                      {copiedId === agent.name ? "Copied!" : "Copy Prompt"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {agent.description && <span>{agent.description}</span>}
                  <span className="flex items-center gap-1">
                    <Shield size={12} />
                    {(agent.defaultScopes ?? "").split(",").filter(Boolean).length} scopes
                  </span>
                  <span className="flex items-center gap-1">
                    <Key size={12} />
                    Created {new Date(agent.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateAgentDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => void agents.refetch()}
      />
    </div>
  );
}
