import { useState } from "react";
import { KeyRound, LockKeyhole, Plus, Trash2, RotateCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function AccessAssetsPanel({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const keys = trpc.managedSshKeys.useQuery(undefined, { enabled: canManage });
  const certificates = trpc.certificateAssets.useQuery(undefined, { enabled: canManage });
  const [keyDraft, setKeyDraft] = useState({ name: "", username: "root", privateKey: "" });
  const [certDraft, setCertDraft] = useState({
    name: "",
    certificatePem: "",
    privateKey: "",
    caChain: ""
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([utils.managedSshKeys.invalidate(), utils.certificateAssets.invalidate()]);
  };

  const createKey = trpc.createManagedSshKey.useMutation({
    onSuccess: async (key) => {
      await refresh();
      setKeyDraft({ name: "", username: "root", privateKey: "" });
      setFeedback(`Created managed SSH key ${key.name}.`);
    },
    onError: (error) => setFeedback(error.message)
  });
  const rotateKey = trpc.rotateManagedSshKey.useMutation({
    onSuccess: async (key) => {
      await refresh();
      setFeedback(`Rotated managed SSH key ${key.name}.`);
    },
    onError: (error) => setFeedback(error.message)
  });
  const deleteKey = trpc.deleteManagedSshKey.useMutation({
    onSuccess: async () => {
      await refresh();
      setFeedback("Deleted managed SSH key.");
    },
    onError: (error) => setFeedback(error.message)
  });
  const createCertificate = trpc.createCertificateAsset.useMutation({
    onSuccess: async (certificate) => {
      await refresh();
      setCertDraft({ name: "", certificatePem: "", privateKey: "", caChain: "" });
      setFeedback(`Created certificate asset ${certificate.name}.`);
    },
    onError: (error) => setFeedback(error.message)
  });
  const deleteCertificate = trpc.deleteCertificateAsset.useMutation({
    onSuccess: async () => {
      await refresh();
      setFeedback("Deleted certificate asset.");
    },
    onError: (error) => setFeedback(error.message)
  });

  function submitKey() {
    const name = keyDraft.name.trim();
    const privateKey = keyDraft.privateKey.trim();
    if (!name || !privateKey) {
      setFeedback("SSH key name and private key are required.");
      return;
    }
    createKey.mutate({
      name,
      username: keyDraft.username.trim() || null,
      privateKey
    });
  }

  function submitCertificate() {
    const name = certDraft.name.trim();
    const certificatePem = certDraft.certificatePem.trim();
    if (!name || !certificatePem) {
      setFeedback("Certificate name and PEM body are required.");
      return;
    }
    createCertificate.mutate({
      name,
      certificatePem,
      privateKey: certDraft.privateKey.trim() || null,
      caChain: certDraft.caChain.trim() || null
    });
  }

  return (
    <div className="space-y-6" data-testid="settings-access-assets">
      <div>
        <h2 className="text-base font-semibold">Access assets</h2>
        <p className="text-sm text-muted-foreground">
          Manage reusable SSH keys and custom certificates without exposing private material.
        </p>
      </div>
      {feedback ? (
        <p className="text-sm text-muted-foreground" data-testid="access-assets-feedback">
          {feedback}
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Managed SSH keys</h3>
          {(keys.data ?? []).map((key) => (
            <Card key={key.id} className="border-border/60 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-sm" data-testid={`ssh-key-name-${key.id}`}>
                      {key.name}
                    </CardTitle>
                    <p className="truncate text-xs text-muted-foreground">{key.fingerprint}</p>
                  </div>
                  {canManage ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Rotate SSH key ${key.name}`}
                        onClick={() => {
                          const privateKey = window.prompt("Replacement private key PEM");
                          if (privateKey) rotateKey.mutate({ keyId: key.id, privateKey });
                        }}
                        data-testid={`ssh-key-rotate-${key.id}`}
                      >
                        <RotateCw size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Delete SSH key ${key.name}`}
                        onClick={() => deleteKey.mutate({ keyId: key.id })}
                        data-testid={`ssh-key-delete-${key.id}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {key.keyType} · {key.status} · {key.username ?? "no default user"}
              </CardContent>
            </Card>
          ))}
          {!keys.isLoading && (keys.data ?? []).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                <KeyRound className="mx-auto mb-2 text-primary/50" size={24} />
                No managed SSH keys yet.
              </CardContent>
            </Card>
          ) : null}
        </div>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Add SSH key</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label>Name</Label>
              <Input
                value={keyDraft.name}
                onChange={(event) => setKeyDraft({ ...keyDraft, name: event.target.value })}
                data-testid="ssh-key-name-input"
              />
              <Label>Default SSH user</Label>
              <Input
                value={keyDraft.username}
                onChange={(event) => setKeyDraft({ ...keyDraft, username: event.target.value })}
                data-testid="ssh-key-username-input"
              />
              <Label>Private key</Label>
              <Textarea
                rows={7}
                value={keyDraft.privateKey}
                onChange={(event) => setKeyDraft({ ...keyDraft, privateKey: event.target.value })}
                data-testid="ssh-key-private-key-input"
              />
              <Button onClick={submitKey} disabled={createKey.isPending} data-testid="ssh-key-add">
                <Plus size={14} /> Add Key
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Certificate assets</h3>
          {(certificates.data ?? []).map((certificate) => (
            <Card key={certificate.id} className="border-border/60 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle
                      className="text-sm"
                      data-testid={`certificate-asset-name-${certificate.id}`}
                    >
                      {certificate.name}
                    </CardTitle>
                    <p className="truncate text-xs text-muted-foreground">
                      {certificate.subject ?? certificate.fingerprint}
                    </p>
                  </div>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Delete certificate ${certificate.name}`}
                      onClick={() => deleteCertificate.mutate({ certificateId: certificate.id })}
                      data-testid={`certificate-asset-delete-${certificate.id}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {certificate.status} · expires {certificate.expiresAt ?? "unknown"} ·{" "}
                {certificate.hasPrivateKey ? "private key stored" : "certificate only"}
              </CardContent>
            </Card>
          ))}
          {!certificates.isLoading && (certificates.data ?? []).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                <LockKeyhole className="mx-auto mb-2 text-primary/50" size={24} />
                No custom certificate assets yet.
              </CardContent>
            </Card>
          ) : null}
        </div>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Add certificate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label>Name</Label>
              <Input
                value={certDraft.name}
                onChange={(event) => setCertDraft({ ...certDraft, name: event.target.value })}
                data-testid="certificate-asset-name-input"
              />
              <Label>Certificate PEM</Label>
              <Textarea
                rows={5}
                value={certDraft.certificatePem}
                onChange={(event) =>
                  setCertDraft({ ...certDraft, certificatePem: event.target.value })
                }
                data-testid="certificate-asset-pem-input"
              />
              <Label>Private key PEM</Label>
              <Textarea
                rows={4}
                value={certDraft.privateKey}
                onChange={(event) => setCertDraft({ ...certDraft, privateKey: event.target.value })}
                data-testid="certificate-asset-private-key-input"
              />
              <Label>CA chain PEM</Label>
              <Textarea
                rows={3}
                value={certDraft.caChain}
                onChange={(event) => setCertDraft({ ...certDraft, caChain: event.target.value })}
                data-testid="certificate-asset-ca-chain-input"
              />
              <Button
                onClick={submitCertificate}
                disabled={createCertificate.isPending}
                data-testid="certificate-asset-add"
              >
                <Plus size={14} /> Add Certificate
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
