import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

type SecretProvider = {
  id: string;
  name: string;
  type: string;
  status: string;
  lastTestedAt: string | Date | null;
  lastTestError: string | null;
  createdAt: string | Date;
};

export type { SecretProvider };

function formatTimestamp(value: string | Date | null) {
  if (!value) return "Not tested";
  return new Date(value).toLocaleString();
}

function statusLabel(provider: SecretProvider) {
  if (!provider.lastTestedAt) return "Pending test";
  return provider.status === "active" ? "Connected" : "Connection failed";
}

function statusKey(provider: SecretProvider) {
  if (!provider.lastTestedAt) return "pending";
  return provider.status;
}

export function SecretProviderCard({
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
    onSuccess: (result: { ok: boolean; error?: string | null }) => {
      setError(result.ok ? null : (result.error ?? "Connection test failed."));
      setFeedback(result.ok ? "Connection test succeeded." : null);
      onChanged();
    },
    onError: (mutationError: { message: string }) => {
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
    onError: (mutationError: { message: string }) => {
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
              <Badge variant={getInventoryBadgeVariant(statusKey(provider))}>
                {statusLabel(provider)}
              </Badge>
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
