import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Check, Copy, Loader2, Plus, Settings2, Trash2 } from "lucide-react";

interface ProjectDetailHeaderProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
  copiedId: boolean;
  showDeleteDialog: boolean;
  isDeletePending: boolean;
  deleteErrorMessage?: string | null;
  onBack: () => void;
  onCopyProjectId: () => void;
  onToggleSettings: () => void;
  onAddService: () => void;
  onDeleteDialogChange: (open: boolean) => void;
  onDeleteTrigger: () => void;
  onConfirmDelete: () => void;
}

export function ProjectDetailHeader({
  projectId,
  projectName,
  projectDescription,
  copiedId,
  showDeleteDialog,
  isDeletePending,
  deleteErrorMessage,
  onBack,
  onCopyProjectId,
  onToggleSettings,
  onAddService,
  onDeleteDialogChange,
  onDeleteTrigger,
  onConfirmDelete
}: ProjectDetailHeaderProps) {
  return (
    <div className="flex items-center justify-between" data-testid="project-detail-header">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="project-back-button">
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{projectName}</h1>
          {projectDescription ? (
            <p className="text-sm text-muted-foreground">{projectDescription}</p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          title="Copy Project ID"
          aria-label="Copy project ID"
          data-testid="project-copy-id"
          onClick={onCopyProjectId}
        >
          {copiedId ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onToggleSettings}
          data-testid="project-settings-toggle"
        >
          <Settings2 size={14} className="mr-1" />
          Settings
        </Button>
        <Button size="sm" variant="outline" title="Duplicate Project">
          <Copy size={14} className="mr-1" />
          Duplicate
        </Button>
        <Button size="sm" onClick={onAddService} data-testid="project-add-service-button">
          <Plus size={14} className="mr-1" />
          Add Service
        </Button>
        <AlertDialog open={showDeleteDialog} onOpenChange={onDeleteDialogChange}>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="destructive"
              aria-label="Delete project"
              onClick={onDeleteTrigger}
              disabled={isDeletePending}
              data-testid={`project-delete-trigger-${projectId}`}
            >
              <Trash2 size={14} className="mr-1" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete project "{projectName}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the project and all its services, environments, and
                deployment history. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletePending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault();
                  if (isDeletePending) {
                    return;
                  }
                  onConfirmDelete();
                }}
                disabled={isDeletePending}
                data-testid={`project-delete-confirm-${projectId}`}
              >
                {isDeletePending ? (
                  <>
                    <Loader2 size={14} className="mr-1 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete Project"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
            {deleteErrorMessage ? (
              <p className="text-sm text-destructive">{deleteErrorMessage}</p>
            ) : null}
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
