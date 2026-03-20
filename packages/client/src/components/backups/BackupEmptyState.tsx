import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, DatabaseBackup, HardDrive } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

interface BackupEmptyStateProps {
  hasDestinations: boolean;
}

export function BackupEmptyState({ hasDestinations }: BackupEmptyStateProps) {
  const destinationsCtaLabel = hasDestinations
    ? "Review Destination Inventory"
    : "Open Destinations";
  const heading = hasDestinations
    ? "Backup destinations are ready"
    : "Add a backup destination first";

  return (
    <Card className="border-dashed shadow-sm" data-testid="backup-empty-state">
      <CardContent className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/10 to-primary/5">
          <DatabaseBackup aria-hidden="true" className="text-primary/60" size={30} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/70">
            {hasDestinations ? "Step 2 of 2" : "Step 1 of 2"}
          </p>
          <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {hasDestinations
              ? "Your storage targets are configured. Backup policies are the remaining setup step, and policies and run history will appear here after the first configuration."
              : "This workspace does not have any backup storage configured yet. Connect a destination first, then return here to create policies and enable schedules."}
          </p>
        </div>

        <div className="grid w-full max-w-2xl gap-3 text-left sm:grid-cols-2">
          <div
            role="group"
            aria-label="Configure destination"
            className="rounded-2xl border border-border/60 bg-muted/30 p-4"
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              {hasDestinations ? (
                <>
                  <CheckCircle2 aria-hidden="true" className="text-emerald-500" size={16} />
                  <span className="sr-only">Step 1 complete</span>
                </>
              ) : (
                <HardDrive aria-hidden="true" className="text-primary/70" size={16} />
              )}
              Configure destination
            </div>
            <p className="text-sm text-muted-foreground">
              Add and test an S3, rclone, or local storage target in the destinations inventory.
            </p>
          </div>

          <div
            role="group"
            aria-label="Create policy"
            className="rounded-2xl border border-border/60 bg-muted/30 p-4"
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              {hasDestinations ? (
                <DatabaseBackup aria-hidden="true" className="text-primary/70" size={16} />
              ) : (
                <ArrowRight aria-hidden="true" className="text-muted-foreground" size={16} />
              )}
              Create policy
            </div>
            <p className="text-sm text-muted-foreground">
              Once a destination exists, create backup policies so schedules, retention, and run
              history can be managed from this page.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            className={cn(
              buttonVariants({ variant: "default", size: "lg" }),
              "hover:bg-primary/90"
            )}
            data-testid="backup-empty-open-destinations"
            to="/destinations"
          >
            {destinationsCtaLabel}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
