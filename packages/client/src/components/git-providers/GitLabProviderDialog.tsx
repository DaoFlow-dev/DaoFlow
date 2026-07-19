import type { FormEvent } from "react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  buildGitLabProviderPayload,
  INITIAL_GITLAB_PROVIDER_FORM,
  isGitLabCredentialMode,
  isGitLabProviderFormValid,
  type GitLabCredentialMode,
  type GitLabProviderFormState
} from "./gitlab-provider-form";

export interface GitLabProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}

const credentialModeDescriptions: Record<GitLabCredentialMode, string> = {
  oauth: "Recommended for full integration, including repository access and provider feedback.",
  api_token: "Use a project or group access token for API operations and provider feedback.",
  deploy_token: "Use a deploy token for repository cloning only. It cannot call the GitLab API."
};

export function GitLabProviderDialog({
  open,
  onOpenChange,
  onRegistered
}: GitLabProviderDialogProps) {
  const [form, setForm] = useState<GitLabProviderFormState>(INITIAL_GITLAB_PROVIDER_FORM);

  function resetForm() {
    setForm(INITIAL_GITLAB_PROVIDER_FORM);
  }

  const register = trpc.registerGitProvider.useMutation({
    onSuccess: () => {
      resetForm();
      onRegistered();
      onOpenChange(false);
    }
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm();
      register.reset();
    }
    onOpenChange(nextOpen);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = buildGitLabProviderPayload(form);
    if (!payload) return;

    register.mutate(payload);
  }

  function updateField<K extends keyof GitLabProviderFormState>(field: K, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleCredentialModeChange(value: string | null) {
    if (!value || !isGitLabCredentialMode(value)) return;
    register.reset();
    setForm((current) => ({
      ...current,
      credentialMode: value,
      ...(value === "oauth"
        ? { apiToken: "", deployUsername: "", deployToken: "", expiresAt: "" }
        : value === "api_token"
          ? { clientId: "", clientSecret: "", deployUsername: "", deployToken: "" }
          : { clientId: "", clientSecret: "", apiToken: "" })
    }));
  }

  const isFormValid = isGitLabProviderFormValid(form);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register GitLab Provider</DialogTitle>
          <DialogDescription>
            Choose how DaoFlow authenticates with GitLab. Secrets are used only for the selected
            credential mode and are never shown on provider cards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gl-name">Name</Label>
            <Input
              id="gl-name"
              data-testid="git-provider-name-input"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="My GitLab"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gl-credential-mode">Credential mode</Label>
            <Select value={form.credentialMode} onValueChange={handleCredentialModeChange}>
              <SelectTrigger id="gl-credential-mode" data-testid="git-provider-credential-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oauth">OAuth (recommended)</SelectItem>
                <SelectItem value="api_token">Project/group API token</SelectItem>
                <SelectItem value="deploy_token">Deploy token (clone only)</SelectItem>
              </SelectContent>
            </Select>
            <p
              className="text-xs text-muted-foreground"
              data-testid="git-provider-credential-mode-description"
            >
              {credentialModeDescriptions[form.credentialMode]}
            </p>
          </div>

          {form.credentialMode === "oauth" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gl-clientid">OAuth client ID</Label>
                <Input
                  id="gl-clientid"
                  data-testid="git-provider-client-id-input"
                  value={form.clientId}
                  onChange={(event) => updateField("clientId", event.target.value)}
                  placeholder="gitlab-client-id"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gl-clientsecret">OAuth client secret</Label>
                <Input
                  id="gl-clientsecret"
                  data-testid="git-provider-client-secret-input"
                  type="password"
                  value={form.clientSecret}
                  onChange={(event) => updateField("clientSecret", event.target.value)}
                  placeholder="gitlab-client-secret"
                  required
                />
              </div>
            </div>
          ) : null}

          {form.credentialMode === "api_token" ? (
            <div className="space-y-2">
              <Label htmlFor="gl-api-token">Project/group API token</Label>
              <Input
                id="gl-api-token"
                data-testid="git-provider-api-token-input"
                type="password"
                value={form.apiToken}
                onChange={(event) => updateField("apiToken", event.target.value)}
                placeholder="glpat-..."
                required
              />
            </div>
          ) : null}

          {form.credentialMode === "deploy_token" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gl-deploy-username">Deploy token username</Label>
                <Input
                  id="gl-deploy-username"
                  data-testid="git-provider-deploy-username-input"
                  value={form.deployUsername}
                  onChange={(event) => updateField("deployUsername", event.target.value)}
                  placeholder="gitlab+deploy-token-..."
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gl-deploy-token">Deploy token</Label>
                <Input
                  id="gl-deploy-token"
                  data-testid="git-provider-deploy-token-input"
                  type="password"
                  value={form.deployToken}
                  onChange={(event) => updateField("deployToken", event.target.value)}
                  placeholder="gldt-..."
                  required
                />
              </div>
            </div>
          ) : null}

          {form.credentialMode !== "oauth" ? (
            <div className="space-y-2">
              <Label htmlFor="gl-expires-at">Token expiry date (optional)</Label>
              <Input
                id="gl-expires-at"
                data-testid="git-provider-expires-at-input"
                type="date"
                value={form.expiresAt}
                onChange={(event) => updateField("expiresAt", event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                DaoFlow stores the selected date as an ISO timestamp for lifecycle checks.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="gl-webhook">Webhook secret (optional)</Label>
            <Input
              id="gl-webhook"
              data-testid="git-provider-webhook-secret-input"
              type="password"
              value={form.webhookSecret}
              onChange={(event) => updateField("webhookSecret", event.target.value)}
              placeholder="Webhook secret"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gl-baseurl">Public GitLab URL</Label>
            <Input
              id="gl-baseurl"
              data-testid="git-provider-base-url-input"
              value={form.baseUrl}
              onChange={(event) => updateField("baseUrl", event.target.value)}
              placeholder="https://gitlab.example.com"
            />
            <p className="text-xs text-muted-foreground" data-testid="git-provider-public-url-help">
              Used for OAuth and public GitLab routing. Leave empty for GitLab.com.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gl-internal-baseurl">Internal GitLab URL (optional)</Label>
            <Input
              id="gl-internal-baseurl"
              data-testid="git-provider-internal-base-url-input"
              value={form.internalBaseUrl}
              onChange={(event) => updateField("internalBaseUrl", event.target.value)}
              placeholder="https://gitlab.internal.example.com"
            />
            <p
              className="text-xs text-muted-foreground"
              data-testid="git-provider-internal-url-help"
            >
              Used by DaoFlow for server-side API and clone traffic. Leave empty to reuse the public
              URL. TLS verification is never bypassed.
            </p>
          </div>

          {register.error ? (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid="git-provider-registration-error"
            >
              {register.error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
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
