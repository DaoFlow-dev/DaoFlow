import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
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
import { Loader2 } from "lucide-react";
import type { EnvironmentDraft, ServerRecord } from "./types";
import { INHERIT_SERVER_VALUE } from "./utils";

interface EnvironmentEditorDialogProps {
  open: boolean;
  draft: EnvironmentDraft;
  servers: ServerRecord[];
  submitPending: boolean;
  errorMessage?: string | null;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (field: keyof EnvironmentDraft, value: string) => void;
  onSubmit: () => void;
}

export function EnvironmentEditorDialog({
  open,
  draft,
  servers,
  submitPending,
  errorMessage,
  onOpenChange,
  onDraftChange,
  onSubmit
}: EnvironmentEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft.id ? "Edit Environment" : "Create Environment"}</DialogTitle>
          <DialogDescription>
            Override target server or Compose settings for one environment without rewriting the
            project-level defaults.
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
            <Label htmlFor="environment-name">Environment Name</Label>
            <Input
              id="environment-name"
              value={draft.name}
              onChange={(event) => onDraftChange("name", event.target.value)}
              placeholder="production"
              required
              data-testid="project-environment-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="environment-status">Status</Label>
            <Select value={draft.status} onValueChange={(value) => onDraftChange("status", value)}>
              <SelectTrigger id="environment-status" data-testid="project-environment-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">active</SelectItem>
                <SelectItem value="paused">paused</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="environment-server">Target Server</Label>
            <Select
              value={draft.targetServerId}
              onValueChange={(value) => onDraftChange("targetServerId", value)}
            >
              <SelectTrigger id="environment-server" data-testid="project-environment-server">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT_SERVER_VALUE}>Project default</SelectItem>
                {servers.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    {server.name}
                    {server.host ? ` · ${server.host}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="environment-compose-files">Compose Files</Label>
            <Input
              id="environment-compose-files"
              value={draft.composeFiles}
              onChange={(event) => onDraftChange("composeFiles", event.target.value)}
              placeholder="compose.yaml, compose.prod.yaml"
              data-testid="project-environment-compose-files"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="environment-compose-profiles">Compose Profiles</Label>
            <Input
              id="environment-compose-profiles"
              value={draft.composeProfiles}
              onChange={(event) => onDraftChange("composeProfiles", event.target.value)}
              placeholder="web, workers"
              data-testid="project-environment-compose-profiles"
            />
          </div>
          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="project-environment-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitPending || !draft.name.trim()}
              data-testid="project-environment-submit"
            >
              {submitPending ? (
                <>
                  <Loader2 size={14} className="mr-1 animate-spin" />
                  Saving...
                </>
              ) : draft.id ? (
                "Save Environment"
              ) : (
                "Create Environment"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
