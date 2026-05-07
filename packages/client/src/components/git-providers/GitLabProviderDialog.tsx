import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";

export interface GitLabProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}

export function GitLabProviderDialog({
  open,
  onOpenChange,
  onRegistered
}: GitLabProviderDialogProps) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const register = trpc.registerGitProvider.useMutation({
    onSuccess: () => {
      onRegistered();
      onOpenChange(false);
      setName("");
      setClientId("");
      setClientSecret("");
      setWebhookSecret("");
      setBaseUrl("");
    }
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    register.mutate({
      type: "gitlab",
      name: name.trim(),
      clientId: clientId.trim() || undefined,
      clientSecret: clientSecret.trim() || undefined,
      webhookSecret: webhookSecret.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined
    });
  }

  const isFormValid =
    Boolean(name.trim()) && Boolean(clientId.trim()) && Boolean(clientSecret.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register GitLab Provider</DialogTitle>
          <DialogDescription>Enter your GitLab OAuth application credentials.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="gl-name">Name</Label>
            <Input
              id="gl-name"
              data-testid="git-provider-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My GitLab"
              required
            />
          </div>
          <div>
            <Label htmlFor="gl-clientid">Client ID</Label>
            <Input
              id="gl-clientid"
              data-testid="git-provider-client-id-input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="gitlab-client-id"
              required
            />
          </div>
          <div>
            <Label htmlFor="gl-clientsecret">Client Secret</Label>
            <Input
              id="gl-clientsecret"
              data-testid="git-provider-client-secret-input"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="gitlab-client-secret"
              required
            />
          </div>
          <div>
            <Label htmlFor="gl-webhook">Webhook Secret</Label>
            <Input
              id="gl-webhook"
              data-testid="git-provider-webhook-secret-input"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="whsec_..."
            />
          </div>
          <div>
            <Label htmlFor="gl-baseurl">Base URL (self-hosted)</Label>
            <Input
              id="gl-baseurl"
              data-testid="git-provider-base-url-input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://gitlab.example.com"
            />
            <p className="text-xs text-muted-foreground mt-1">Leave empty for gitlab.com</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="git-provider-cancel-button"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={register.isPending || !isFormValid}
              data-testid="git-provider-register-button"
            >
              {register.isPending ? "Registering..." : "Register"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
