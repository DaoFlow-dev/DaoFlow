import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Github } from "lucide-react";
import { buildGitHubManifest } from "./git-provider-utils";

export interface GitHubProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}

export function GitHubProviderDialog({
  open,
  onOpenChange,
  onRegistered
}: GitHubProviderDialogProps) {
  const [isOrganization, setIsOrganization] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [showManualForm, setShowManualForm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const appBaseUrl = window.location.origin;
  const manifest = buildGitHubManifest(appBaseUrl, appBaseUrl);

  const githubFormTarget =
    isOrganization && orgName.trim()
      ? `https://github.com/organizations/${orgName.trim()}/settings/apps/new`
      : "https://github.com/settings/apps/new";
  const startManifestSetup = trpc.startGitHubAppManifestSetup.useMutation({
    onSuccess: ({ state }) => {
      const form = formRef.current;
      if (!form) return;
      form.action = `${githubFormTarget}?state=${encodeURIComponent(state)}`;
      form.submit();
    }
  });

  function handleManifestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startManifestSetup.mutate();
  }

  if (showManualForm) {
    return (
      <ManualGitHubProviderDialog
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v);
          if (!v) setShowManualForm(false);
        }}
        onRegistered={() => {
          onRegistered();
          setShowManualForm(false);
        }}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setIsOrganization(false);
          setOrgName("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github size={20} /> GitHub Provider
          </DialogTitle>
          <DialogDescription>
            To integrate your GitHub account with DaoFlow, we'll create and install a GitHub App.
            This process is straightforward and only takes a few minutes. Click the button below to
            get started.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="org-toggle">Organization?</Label>
            <Switch
              id="org-toggle"
              checked={isOrganization}
              onCheckedChange={setIsOrganization}
              data-testid="github-org-toggle"
            />
          </div>

          {isOrganization && (
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Organization name"
              data-testid="github-org-name-input"
            />
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <form
            ref={formRef}
            method="post"
            action={githubFormTarget}
            onSubmit={handleManifestSubmit}
          >
            <input type="hidden" name="manifest" value={JSON.stringify(manifest)} />
            <Button
              type="submit"
              className="w-full"
              disabled={startManifestSetup.isPending || (isOrganization && !orgName.trim())}
              data-testid="github-create-app-button"
            >
              Create GitHub App
            </Button>
          </form>

          <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setShowManualForm(true)}
              className="underline hover:text-foreground"
              data-testid="github-manual-link"
            >
              Advanced: enter credentials manually
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualGitHubProviderDialog({
  open,
  onOpenChange,
  onRegistered
}: GitHubProviderDialogProps) {
  const [name, setName] = useState("");
  const [appId, setAppId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const register = trpc.registerGitProvider.useMutation({
    onSuccess: () => {
      onRegistered();
      onOpenChange(false);
      setName("");
      setAppId("");
      setClientId("");
      setClientSecret("");
      setPrivateKey("");
      setWebhookSecret("");
      setBaseUrl("");
    }
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    register.mutate({
      type: "github",
      name: name.trim(),
      appId: appId.trim() || undefined,
      clientId: clientId.trim() || undefined,
      clientSecret: clientSecret.trim() || undefined,
      privateKey: privateKey.trim() || undefined,
      webhookSecret: webhookSecret.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined
    });
  }

  const isFormValid =
    Boolean(name.trim()) &&
    Boolean(appId.trim()) &&
    Boolean(clientId.trim()) &&
    Boolean(clientSecret.trim()) &&
    Boolean(privateKey.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register GitHub App Manually</DialogTitle>
          <DialogDescription>
            For GitHub Enterprise or advanced setups, enter your GitHub App credentials directly.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="gp-name">Name</Label>
            <Input
              id="gp-name"
              data-testid="git-provider-name-input"
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
              data-testid="git-provider-app-id-input"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="123456"
              required
            />
          </div>
          <div>
            <Label htmlFor="gp-privatekey">Private Key</Label>
            <Textarea
              id="gp-privatekey"
              data-testid="git-provider-private-key-input"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
              required
              rows={6}
            />
          </div>
          <div>
            <Label htmlFor="gp-client-id">Client ID</Label>
            <Input
              id="gp-client-id"
              data-testid="git-provider-client-id-input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Iv1.0123456789abcdef"
              required
            />
          </div>
          <div>
            <Label htmlFor="gp-client-secret">Client Secret</Label>
            <Input
              id="gp-client-secret"
              data-testid="git-provider-client-secret-input"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GitHub App client secret"
              required
            />
          </div>
          <div>
            <Label htmlFor="gp-webhook">Webhook Secret</Label>
            <Input
              id="gp-webhook"
              data-testid="git-provider-webhook-secret-input"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="whsec_..."
            />
          </div>
          <div>
            <Label htmlFor="gp-baseurl">Base URL (GitHub Enterprise)</Label>
            <Input
              id="gp-baseurl"
              data-testid="git-provider-base-url-input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://github.example.com"
            />
            <p className="text-xs text-muted-foreground mt-1">Leave empty for github.com</p>
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
