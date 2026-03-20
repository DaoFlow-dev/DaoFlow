import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { getBackupOperationBadgeVariant } from "@/lib/tone-utils";
import { BackupRunDetailsContent, type BackupRunDetailsView } from "./BackupRunDetailsContent";

export type { BackupRunDetailsView } from "./BackupRunDetailsContent";

interface BackupRunDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  errorMessage: string | null;
  run: BackupRunDetailsView | null | undefined;
}

export function BackupRunDetailsSheet({
  open,
  onOpenChange,
  isLoading,
  errorMessage,
  run
}: BackupRunDetailsSheetProps) {
  const liveStatus = run && (run.status === "queued" || run.status === "running");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-3xl"
        data-testid="backup-run-details-sheet"
      >
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle data-testid="backup-run-details-title">
              {run ? run.serviceName || run.policyName : "Backup run details"}
            </SheetTitle>
            {run ? (
              <Badge
                variant={getBackupOperationBadgeVariant(run.status)}
                data-testid="backup-run-details-status"
              >
                {run.status}
              </Badge>
            ) : null}
            {liveStatus ? (
              <Badge variant="secondary" data-testid="backup-run-details-live">
                Live polling
              </Badge>
            ) : null}
          </div>
          <SheetDescription data-testid="backup-run-details-description">
            {run
              ? `${run.environmentName || "Unknown environment"} · ${run.targetType} backup · ${run.triggerKind}`
              : "Inspect backup execution metadata and persisted logs."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <BackupRunDetailsContent isLoading={isLoading} errorMessage={errorMessage} run={run} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
