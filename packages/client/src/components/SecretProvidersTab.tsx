import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, KeyRound, Plus, RefreshCw, Shield, Trash2 } from "lucide-react";

type SecretProvider = {
  id: string;
  name: string;
  type: string;
  status: string;
  lastTestedAt: string | Date | null;
  lastTestError: string | null;
  createdAt: string | Date;
};

function formatTimestamp(value: string | Date | null) {
  if (!value) {
    return "Not tested";
  }

  return new Date(value).toLocaleString();
}

function statusLabel(provider: SecretProvider) {
  if (!provider.lastTestedAt) {
    return "Pending test";
  }

  return provider.status === "active" ? "Connected" : "Connection failed";
}

function statusVariant(provider: SecretProvider): "default" | "secondary" | "destructive" {
  if (!provider.lastTestedAt) {
    return "secondary";
  }

  return provider.status === "active" ? "default" : "destructive";
}

export default function SecretProvidersTab() {
  const utils = trpc.useUtils();
  const providers = trpc.listSecretProviders.useQuery();
  const [showRegister, setShowRegister] = useState(false);

  async function refreshProviders() {
    await utils.listSecretProviders.invalidate();
  }

  return (
    <div className="space-y-4" data-testid="secret-providers-tab">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Secret Providers</h3>
          <p className="text-sm text-muted-foreground">
            Connect 1Password service accounts and validate them before using `op://` references.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowRegister(true)}>
          <Plus size={14} className="mr-1" /> Add Provider
        </Button>
      </div>

      {providers.isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading secret providers…
          </CardContent>
        </Card>
      ) : (providers.data ?? []).length === 0 ? (
        <Card data-testid="secret-providers-empty">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Shield size={32} className="mx-auto mb-3 opacity-40" />
            <p>No secret providers configured.</p>
            <p className="mt-1 text-xs">
              Add a 1Password service account to resolve `op://vault/item/field` references at
              deploy time.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(providers.data ?? []).map((provider) => (
            <SecretProviderCard
              key={provider.id}
              provider={provider}
              onChanged={() => void refreshProviders()}
            />
          ))}
        </div>
      )}

      <RegisterSecretProviderDialog
        open={showRegister}
        onOpenChange={setShowRegister}
        onRegistered={() => void refreshProviders()}
      />
    </div>
  );
}

function SecretProviderCard({
  provider,
  onChanged
}: {
  provider: SecretProvider;
  onChanged: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testProvider = trpc.testSecretProvider.useMutation({
    onSuccess: (result) => {
      setError(result.ok ? null : (result.error ?? "Connection test failed."));
      setFeedback(result.ok ? "Connection test succeeded." : null);
      onChanged();
    },
    onError: (mutationError) => {
      setFeedback(null);
      setError(mutationError.message);
    }
  });

  const deleteProvider = trpc.deleteSecretProvider.useMutation({
    onSuccess: () => {
      setShowDelete(false);
      setFeedback(null);
      setError(null);
      onChanged();
    },
    onError: (mutationError) => {
      setFeedback(null);
      setError(mutationError.message);
    }
  });

  return (
    <>
      <Card data-testid={`secret-provider-${provider.id}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound size={16} />
                {provider.name}
              </CardTitle>
              <CardDescription>
                1Password service account · Created{" "}
                {new Date(provider.createdAt).toLocaleDateString()}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{provider.type}</Badge>
              <Badge variant={statusVariant(provider)}>{statusLabel(provider)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <div className="space-y-1 text-muted-foreground">
              <p>Last tested: {formatTimestamp(provider.lastTestedAt)}</p>
              {provider.lastTestError ? (
                <p className="text-destructive">{provider.lastTestError}</p>
              ) : (
                <p>Ready to resolve masked secret metadata for agent-safe previews.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={testProvider.isPending}
                onClick={() => {
                  setFeedback(null);
                  setError(null);
                  testProvider.mutate({ providerId: provider.id });
                }}
              >
                <RefreshCw size={14} className="mr-1" />
                {testProvider.isPending ? "Testing…" : "Test"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowDelete(true)}>
                <Trash2 size={14} className="mr-1" />
                Delete
              </Button>
            </div>
          </div>

          {feedback ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{feedback}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Secret Provider</DialogTitle>
            <DialogDescription>
              Remove {provider.name}? Existing `op://` references will stop resolving until another
              provider is configured.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteProvider.isPending}
              onClick={() => deleteProvider.mutate({ providerId: provider.id })}
            >
              {deleteProvider.isPending ? "Deleting…" : "Delete Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RegisterSecretProviderDialog({
  open,
  onOpenChange,
  onRegistered
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}) {
  const [name, setName] = useState("");
  const [serviceAccountToken, setServiceAccountToken] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createProvider = trpc.createSecretProvider.useMutation({
    onError: (mutationError) => {
      setFeedback(null);
      setError(mutationError.message);
    }
  });

  const testProvider = trpc.testSecretProvider.useMutation({
    onError: (mutationError) => {
      setFeedback(null);
      setError(mutationError.message);
    }
  });

  function resetState() {
    setName("");
    setServiceAccountToken("");
    setFeedback(null);
    setError(null);
  }

  async function handleSubmit(mode: "save" | "save-and-test") {
    setFeedback(null);
    setError(null);

    try {
      const provider = await createProvider.mutateAsync({
        name: name.trim(),
        type: "1password",
        serviceAccountToken: serviceAccountToken.trim()
      });

      if (mode === "save-and-test") {
        const result = await testProvider.mutateAsync({ providerId: provider.id });
        if (!result.ok) {
          setError(result.error ?? "Connection test failed.");
          return;
        }
      }

      setFeedback(mode === "save" ? "Provider saved." : "Provider saved and connection verified.");
      onRegistered();
      resetState();
      onOpenChange(false);
    } catch (submitError) {
      setFeedback(null);
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  }

  const isPending = createProvider.isPending || testProvider.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="secret-provider-dialog">
        <DialogHeader>
          <DialogTitle>Add Secret Provider</DialogTitle>
          <DialogDescription>
            Register a 1Password service account token. DaoFlow stores the token encrypted and only
            uses it to resolve `op://` references.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sp-name">Provider Name</Label>
            <Input
              id="sp-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Production 1Password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-token">Service Account Token</Label>
            <Input
              id="sp-token"
              type="password"
              value={serviceAccountToken}
              onChange={(event) => setServiceAccountToken(event.target.value)}
              placeholder="ops_..."
              required
            />
          </div>

          {feedback ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{feedback}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!name.trim() || !serviceAccountToken.trim() || isPending}
              onClick={() => void handleSubmit("save")}
            >
              {createProvider.isPending && !testProvider.isPending ? "Saving…" : "Save Provider"}
            </Button>
            <Button
              disabled={!name.trim() || !serviceAccountToken.trim() || isPending}
              onClick={() => void handleSubmit("save-and-test")}
            >
              {isPending ? "Saving…" : "Save + Test"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
