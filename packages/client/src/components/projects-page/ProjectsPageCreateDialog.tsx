import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";
import type { NewProjectDraft } from "@/pages/projects-page/projects-page-types";

interface ProjectsPageCreateDialogProps {
  open: boolean;
  draft: NewProjectDraft;
  isPending: boolean;
  errorMessage?: string;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (field: keyof NewProjectDraft, value: string) => void;
  onSubmit: () => void;
}

export function ProjectsPageCreateDialog({
  open,
  draft,
  isPending,
  errorMessage,
  onOpenChange,
  onDraftChange,
  onSubmit
}: ProjectsPageCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="projects-new-project-trigger">
          <Plus size={16} /> New Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Set up a new deployment project. You can add environments after creation.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="project-name">Project Name *</Label>
            <Input
              id="project-name"
              data-testid="projects-create-name"
              placeholder="my-web-app"
              value={draft.name}
              onChange={(event) => onDraftChange("name", event.target.value)}
              required
              minLength={1}
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-desc">Description</Label>
            <Input
              id="project-desc"
              data-testid="projects-create-description"
              placeholder="Production web application"
              value={draft.description}
              onChange={(event) => onDraftChange("description", event.target.value)}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-repo">Git Repository URL</Label>
            <Input
              id="project-repo"
              data-testid="projects-create-repo-url"
              placeholder="https://github.com/org/repo"
              value={draft.repoUrl}
              onChange={(event) => onDraftChange("repoUrl", event.target.value)}
              maxLength={300}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="projects-create-cancel"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="projects-create-submit"
              disabled={!draft.name || isPending}
            >
              {isPending ? (
                <>
                  <Loader2 size={14} className="mr-1 animate-spin" /> Creating…
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </div>
          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
