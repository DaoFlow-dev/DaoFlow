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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
          <div className="space-y-2">
            <Label htmlFor="project-repo-credential-kind">Repository Credential</Label>
            <Select
              value={draft.repositoryCredentialKind}
              onValueChange={(value) =>
                onDraftChange(
                  "repositoryCredentialKind",
                  value as NewProjectDraft["repositoryCredentialKind"]
                )
              }
            >
              <SelectTrigger
                id="project-repo-credential-kind"
                data-testid="projects-create-repo-credential-kind"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="https_token">HTTPS token</SelectItem>
                <SelectItem value="https_basic">HTTPS basic</SelectItem>
                <SelectItem value="ssh_key">SSH key</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.repositoryCredentialKind === "https_token" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="project-repo-token-username">Username</Label>
                <Input
                  id="project-repo-token-username"
                  data-testid="projects-create-repo-credential-username"
                  value={draft.repositoryCredentialUsername}
                  onChange={(event) =>
                    onDraftChange("repositoryCredentialUsername", event.target.value)
                  }
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-repo-token">Token *</Label>
                <Input
                  id="project-repo-token"
                  data-testid="projects-create-repo-credential-token"
                  type="password"
                  value={draft.repositoryCredentialToken}
                  onChange={(event) =>
                    onDraftChange("repositoryCredentialToken", event.target.value)
                  }
                  required
                />
              </div>
            </div>
          ) : null}
          {draft.repositoryCredentialKind === "https_basic" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="project-repo-basic-username">Username *</Label>
                <Input
                  id="project-repo-basic-username"
                  data-testid="projects-create-repo-credential-basic-username"
                  value={draft.repositoryCredentialUsername}
                  onChange={(event) =>
                    onDraftChange("repositoryCredentialUsername", event.target.value)
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-repo-basic-password">Password *</Label>
                <Input
                  id="project-repo-basic-password"
                  data-testid="projects-create-repo-credential-password"
                  type="password"
                  value={draft.repositoryCredentialPassword}
                  onChange={(event) =>
                    onDraftChange("repositoryCredentialPassword", event.target.value)
                  }
                  required
                />
              </div>
            </div>
          ) : null}
          {draft.repositoryCredentialKind === "ssh_key" ? (
            <div className="space-y-2">
              <Label htmlFor="project-repo-ssh-key">Private Key *</Label>
              <Textarea
                id="project-repo-ssh-key"
                data-testid="projects-create-repo-credential-ssh-key"
                value={draft.repositoryCredentialPrivateKey}
                onChange={(event) =>
                  onDraftChange("repositoryCredentialPrivateKey", event.target.value)
                }
                required
                className="min-h-28 font-mono text-xs"
              />
            </div>
          ) : null}
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
