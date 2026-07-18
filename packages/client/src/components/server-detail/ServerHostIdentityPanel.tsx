import { useState } from "react";
import { Fingerprint, RefreshCw, RotateCw, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ServerHostIdentityPanelProps {
  serverId: string;
  canManage: boolean;
}

type HostIdentity = {
  id: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  status: string;
  observedAt: string;
  lastObservedAt: string;
  approvedAt: string | null;
  supersededAt: string | null;
};

export function ServerHostIdentityPanel({ serverId, canManage }: ServerHostIdentityPanelProps) {
  const utils = trpc.useUtils();
  const [feedback, setFeedback] = useState<string | null>(null);
  const identities = trpc.serverSshHostIdentities.useQuery({ serverId });
  const scan = trpc.scanServerSshHostIdentities.useMutation();
  const approve = trpc.approveServerSshHostIdentity.useMutation();
  const rotate = trpc.rotateServerSshHostIdentity.useMutation();
  const approved = identities.data?.approved;
  const rows = (identities.data?.identities ?? []) as HostIdentity[];
  const isPending = scan.isPending || approve.isPending || rotate.isPending;

  async function refresh(message: string) {
    setFeedback(message);
    await Promise.all([identities.refetch(), utils.serverReadiness.invalidate()]);
  }

  async function scanIdentities() {
    setFeedback(null);
    try {
      const result = await scan.mutateAsync({ serverId });
      await refresh(
        result.verification === "mismatch"
          ? "The currently approved key did not match the newly observed host key. SSH remains blocked."
          : "SSH host keys were discovered. Review and approve the exact key before connecting."
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to scan SSH host keys.");
    }
  }

  async function approveIdentity(identity: HostIdentity, rotation: boolean) {
    setFeedback(null);
    const input = {
      serverId,
      identityId: identity.id,
      algorithm: identity.algorithm,
      publicKey: identity.publicKey,
      fingerprint: identity.fingerprint
    };
    try {
      if (rotation) {
        await rotate.mutateAsync(input);
        await refresh("SSH host key rotation was approved and recorded.");
      } else {
        await approve.mutateAsync(input);
        await refresh("SSH host identity was approved. DaoFlow can now verify this host strictly.");
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to approve the SSH host key.");
    }
  }

  return (
    <Card data-testid={`ssh-host-identity-panel-${serverId}`}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle
              className="flex items-center gap-2 text-base"
              data-testid={`ssh-host-identity-title-${serverId}`}
            >
              <Fingerprint size={16} /> SSH host identity
            </CardTitle>
            <CardDescription data-testid={`ssh-host-identity-description-${serverId}`}>
              DaoFlow only sends credentials after an owner or admin approves one exact observed
              host key.
            </CardDescription>
          </div>
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void scanIdentities()}
              disabled={isPending}
              data-testid={`ssh-host-identity-scan-${serverId}`}
            >
              <RefreshCw size={14} className="mr-1" /> Scan keys
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`ssh-host-identity-feedback-${serverId}`}
          >
            {feedback}
          </p>
        ) : null}

        {approved ? (
          <div
            className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3"
            data-testid={`ssh-host-identity-approved-${serverId}`}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <ShieldCheck size={15} /> Approved for strict verification
            </div>
            <p
              className="mt-2 font-mono text-xs"
              data-testid={`ssh-host-identity-approved-algorithm-${serverId}`}
            >
              {approved.algorithm}
            </p>
            <p
              className="mt-1 break-all font-mono text-xs"
              data-testid={`ssh-host-identity-approved-fingerprint-${serverId}`}
            >
              {approved.fingerprint}
            </p>
          </div>
        ) : (
          <p
            className="text-sm text-amber-700 dark:text-amber-400"
            data-testid={`ssh-host-identity-unapproved-${serverId}`}
          >
            No SSH host key is approved. Remote SSH and SCP operations are blocked.
          </p>
        )}

        {identities.isLoading ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`ssh-host-identity-loading-${serverId}`}
          >
            Loading observed host keys…
          </p>
        ) : rows.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`ssh-host-identity-empty-${serverId}`}
          >
            No host keys have been discovered yet. Scan this server before approving it.
          </p>
        ) : (
          <div className="space-y-3" data-testid={`ssh-host-identity-list-${serverId}`}>
            {rows.map((identity) => {
              const canApprove = canManage && identity.status === "observed";
              const isRotation = Boolean(approved && canApprove);
              return (
                <div
                  key={identity.id}
                  className="rounded-md border p-3"
                  data-testid={`ssh-host-identity-row-${identity.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge
                      variant={identity.status === "approved" ? "default" : "outline"}
                      data-testid={`ssh-host-identity-status-${identity.id}`}
                    >
                      {identity.status}
                    </Badge>
                    <span
                      className="font-mono text-xs"
                      data-testid={`ssh-host-identity-algorithm-${identity.id}`}
                    >
                      {identity.algorithm}
                    </span>
                  </div>
                  <p
                    className="mt-2 break-all font-mono text-xs"
                    data-testid={`ssh-host-identity-fingerprint-${identity.id}`}
                  >
                    {identity.fingerprint}
                  </p>
                  {isRotation && approved ? (
                    <div
                      className="mt-3 rounded bg-muted p-2 text-xs"
                      data-testid={`ssh-host-identity-rotation-${identity.id}`}
                    >
                      <p data-testid={`ssh-host-identity-rotation-old-${identity.id}`}>
                        Current: {approved.fingerprint}
                      </p>
                      <p
                        className="mt-1"
                        data-testid={`ssh-host-identity-rotation-new-${identity.id}`}
                      >
                        Observed: {identity.fingerprint}
                      </p>
                    </div>
                  ) : null}
                  {canApprove ? (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant={isRotation ? "destructive" : "default"}
                      disabled={isPending}
                      onClick={() => void approveIdentity(identity, isRotation)}
                      data-testid={
                        isRotation
                          ? `ssh-host-identity-rotate-${identity.id}`
                          : `ssh-host-identity-approve-${identity.id}`
                      }
                    >
                      {isRotation ? (
                        <RotateCw size={14} className="mr-1" />
                      ) : (
                        <ShieldCheck size={14} className="mr-1" />
                      )}
                      {isRotation ? "Approve rotation" : "Approve exact key"}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
