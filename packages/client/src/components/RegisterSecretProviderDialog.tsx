import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

interface RegisterSecretProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}

export function RegisterSecretProviderDialog({
  open,
  onOpenChange,
  onRegistered
}: RegisterSecretProviderDialogProps) {
  const [name, setName] = useState("");
  const [serviceAccountToken, setServiceAccountToken] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createProvider = trpc.createSecretProvider.useMutation({
    onError: (mutationError: { message: string }) => {
      setFeedback(null);
      setError(mutationError.message);
    }
  });

  const testProvider = trpc.testSecretProvider.useMutation({
    onError: (mutationError: { message: string }) => {
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
        if (!nextOpen) resetState();
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
