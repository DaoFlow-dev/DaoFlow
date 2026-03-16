import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { GitBranch, Plus, Trash2 } from "lucide-react";

export default function GitProvidersTab() {
  const [showRegister, setShowRegister] = useState(false);
  const providers = trpc.gitProviders.useQuery();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Git Providers</h3>
          <p className="text-sm text-muted-foreground">
            Connect GitHub or GitLab Apps for source code integration.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowRegister(true)}>
          <Plus size={14} className="mr-1" /> Add Provider
        </Button>
      </div>

      {providers.data?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <GitBranch size={32} className="mx-auto mb-3 opacity-40" />
            <p>No git providers configured.</p>
            <p className="text-xs mt-1">
              Add a GitHub App or GitLab OAuth app to enable source-code integration.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {providers.data?.map((p) => (
            <ProviderCard key={p.id} provider={p} onDeleted={() => void providers.refetch()} />
          ))}
        </div>
      )}

      <RegisterProviderDialog
        open={showRegister}
        onOpenChange={setShowRegister}
        onRegistered={() => void providers.refetch()}
      />
    </div>
  );
}

/* ── Provider Card ── */

function ProviderCard({
  provider,
  onDeleted
}: {
  provider: { id: string; type: string; name: string; status: string; appId: string | null };
  onDeleted: () => void;
}) {
  const deleteMutation = trpc.deleteGitProvider.useMutation({
    onSuccess: onDeleted
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch size={16} />
            {provider.name}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{provider.type}</Badge>
            <Badge variant={provider.status === "active" ? "default" : "secondary"}>
              {provider.status}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteMutation.mutate({ providerId: provider.id })}
              disabled={deleteMutation.isPending}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">App ID: {provider.appId ?? "—"}</p>
      </CardContent>
    </Card>
  );
}

/* ── Register Dialog ── */

function RegisterProviderDialog({
  open,
  onOpenChange,
  onRegistered
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}) {
  const [type, setType] = useState<"github" | "gitlab">("github");
  const [name, setName] = useState("");
  const [appId, setAppId] = useState("");
  const [clientId, setClientId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const register = trpc.registerGitProvider.useMutation({
    onSuccess: () => {
      onRegistered();
      onOpenChange(false);
      setName("");
      setAppId("");
      setClientId("");
      setWebhookSecret("");
    }
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    register.mutate({
      type,
      name: name.trim(),
      appId: appId.trim() || undefined,
      clientId: clientId.trim() || undefined,
      webhookSecret: webhookSecret.trim() || undefined
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register Git Provider</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Type</Label>
            <div className="flex gap-2 mt-1">
              {(["github", "gitlab"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-3 py-1.5 text-sm rounded-md border ${
                    type === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-input hover:bg-muted"
                  }`}
                >
                  {t === "github" ? "GitHub" : "GitLab"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="gp-name">Name</Label>
            <Input
              id="gp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My GitHub App"
              required
            />
          </div>
          <div>
            <Label htmlFor="gp-appid">App ID</Label>
            <Input
              id="gp-appid"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="123456"
            />
          </div>
          <div>
            <Label htmlFor="gp-clientid">Client ID</Label>
            <Input
              id="gp-clientid"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Iv1.abc123..."
            />
          </div>
          <div>
            <Label htmlFor="gp-webhook">Webhook Secret</Label>
            <Input
              id="gp-webhook"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="whsec_..."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={register.isPending || !name.trim()}>
              {register.isPending ? "Registering…" : "Register"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
