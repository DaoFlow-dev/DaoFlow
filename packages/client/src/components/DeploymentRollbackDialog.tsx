import { useState } from "react";
import { trpc } from "../lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw } from "lucide-react";

interface Props {
  serviceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRolledBack: () => void;
}

export default function DeploymentRollbackDialog({
  serviceId,
  open,
  onOpenChange,
  onRolledBack
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const targets = trpc.rollbackTargets.useQuery({ serviceId }, { enabled: open });

  const rollback = trpc.executeRollback.useMutation({
    onSuccess: () => {
      onRolledBack();
      onOpenChange(false);
      setSelectedId(null);
    }
  });

  function handleRollback() {
    if (!selectedId) return;
    rollback.mutate({ serviceId, targetDeploymentId: selectedId });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw size={16} /> Rollback Service
          </DialogTitle>
        </DialogHeader>

        {targets.isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Loading rollback targets…</p>
        ) : targets.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No successful deployments available for rollback.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {targets.data?.map((t) => (
              <button
                key={t.deploymentId}
                type="button"
                onClick={() => setSelectedId(t.deploymentId)}
                className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                  selectedId === t.deploymentId
                    ? "bg-primary/10 border-primary"
                    : "bg-background border-input hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.serviceName}</span>
                  <Badge variant="secondary">{t.sourceType}</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  {t.commitSha && <span>commit: {t.commitSha.slice(0, 7)}</span>}
                  {t.imageTag && <span>tag: {t.imageTag}</span>}
                  {t.concludedAt && <span>{new Date(t.concludedAt).toLocaleString()}</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRollback}
            disabled={!selectedId || rollback.isPending}
            variant="destructive"
          >
            {rollback.isPending ? "Rolling back…" : "Confirm Rollback"}
          </Button>
        </DialogFooter>

        {rollback.error && (
          <p className="text-sm text-destructive mt-2">{rollback.error.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
