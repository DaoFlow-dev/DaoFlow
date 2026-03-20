import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { HardDrive } from "lucide-react";
import { useState } from "react";
import { AddDestinationDialog, type DestinationFormData } from "@/components/AddDestinationDialog";
import { DestinationsTable } from "@/components/DestinationsTable";

export default function DestinationsPage() {
  const session = useSession();
  const destinations = trpc.backupDestinations.useQuery({}, { enabled: Boolean(session.data) });
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);

  const createMutation = trpc.createBackupDestination.useMutation({
    onSuccess: () => {
      void utils.backupDestinations.invalidate();
      setDialogOpen(false);
    }
  });

  const testMutation = trpc.testBackupDestination.useMutation({
    onSuccess: () => {
      void utils.backupDestinations.invalidate();
    }
  });
  const deleteMutation = trpc.deleteBackupDestination.useMutation({
    onSuccess: () => {
      void utils.backupDestinations.invalidate();
    }
  });

  function handleCreate(data: DestinationFormData) {
    createMutation.mutate(data);
  }

  const list = destinations.data ?? [];

  return (
    <main className="shell space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backup Destinations</h1>
          <p className="text-sm text-muted-foreground">
            Configure where backups are stored — S3, Google Drive, OneDrive, local, or any rclone
            remote.
          </p>
        </div>
        <AddDestinationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleCreate}
          isPending={createMutation.isPending}
        />
      </div>

      {destinations.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
            <HardDrive size={28} className="text-primary/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No backup destinations configured</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a destination to complete setup step 1 of 2, then return to Backups to create
              policies and schedules.
            </p>
          </div>
        </div>
      ) : (
        <DestinationsTable
          destinations={list}
          onTest={(id) => testMutation.mutate({ id })}
          onDelete={(id) => deleteMutation.mutate({ id })}
          isTestPending={testMutation.isPending}
          isDeletePending={deleteMutation.isPending}
        />
      )}
    </main>
  );
}
