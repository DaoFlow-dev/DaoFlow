import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import type { EnvironmentRecord } from "./types";

interface EnvironmentDeleteDialogProps {
  deletePending: boolean;
  target: EnvironmentRecord | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function EnvironmentDeleteDialog({
  deletePending,
  target,
  onOpenChange,
  onConfirm
}: EnvironmentDeleteDialogProps) {
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete environment "{target?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the environment and any services attached to it. This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={deletePending}
            data-testid="project-environment-delete-cancel"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={deletePending}
            data-testid={target ? `project-environment-delete-confirm-${target.id}` : undefined}
          >
            {deletePending ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete Environment"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
