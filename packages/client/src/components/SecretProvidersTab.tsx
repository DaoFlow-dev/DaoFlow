import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Shield } from "lucide-react";
import { SecretProviderCard } from "./SecretProviderCard";
import { RegisterSecretProviderDialog } from "./RegisterSecretProviderDialog";

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
