import type { Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { NO_DESTINATION, type PolicyDraft } from "./backup-policy-manager-types";

interface BackupPolicyDialogProps {
  destinationLabelById: Map<string, string>;
  destinationOptions: Array<{ id: string; name: string }>;
  dialogOpen: boolean;
  draft: PolicyDraft;
  setDialogOpen: (open: boolean) => void;
  setDraft: Dispatch<SetStateAction<PolicyDraft>>;
  submitPending: boolean;
  submitPolicy: () => void;
  volumeLabelById: Map<string, string>;
  volumeOptions: Array<{ id: string; volumeName: string }>;
}

export function BackupPolicyDialog({
  destinationLabelById,
  destinationOptions,
  dialogOpen,
  draft,
  setDialogOpen,
  setDraft,
  submitPending,
  submitPolicy,
  volumeLabelById,
  volumeOptions
}: BackupPolicyDialogProps) {
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle data-testid="backup-policy-dialog-title">
            {draft.id ? "Edit Backup Policy" : "Create Backup Policy"}
          </DialogTitle>
          <DialogDescription>
            Bind one registered volume to one policy so restore and coverage metadata stay stable.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="backup-policy-name">Policy name</Label>
            <Input
              id="backup-policy-name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              data-testid="backup-policy-name-input"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="backup-policy-volume">Volume</Label>
            <Select
              value={draft.volumeId}
              onValueChange={(value) => setDraft((current) => ({ ...current, volumeId: value }))}
            >
              <SelectTrigger id="backup-policy-volume" data-testid="backup-policy-volume-select">
                {volumeLabelById.get(draft.volumeId) ?? "Select a volume"}
              </SelectTrigger>
              <SelectContent>
                {volumeOptions.map((volume) => (
                  <SelectItem key={volume.id} value={volume.id}>
                    {volumeLabelById.get(volume.id) ?? volume.volumeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="backup-policy-destination">Destination</Label>
              <Select
                value={draft.destinationId}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, destinationId: value }))
                }
              >
                <SelectTrigger
                  id="backup-policy-destination"
                  data-testid="backup-policy-destination-select"
                >
                  {draft.destinationId === NO_DESTINATION
                    ? "Unassigned"
                    : (destinationLabelById.get(draft.destinationId) ?? "Select a destination")}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DESTINATION}>Unassigned</SelectItem>
                  {destinationOptions.map((destination) => (
                    <SelectItem key={destination.id} value={destination.id}>
                      {destination.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="backup-policy-type">Backup type</Label>
              <Select
                value={draft.backupType}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    backupType: value as PolicyDraft["backupType"]
                  }))
                }
              >
                <SelectTrigger id="backup-policy-type" data-testid="backup-policy-type-select">
                  {draft.backupType}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="volume">volume</SelectItem>
                  <SelectItem value="database">database</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="backup-policy-engine">Database engine</Label>
              <Input
                id="backup-policy-engine"
                value={draft.databaseEngine}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, databaseEngine: event.target.value }))
                }
                disabled={draft.backupType !== "database"}
                data-testid="backup-policy-engine-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="backup-policy-retention">Retention days</Label>
              <Input
                id="backup-policy-retention"
                value={draft.retentionDays}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, retentionDays: event.target.value }))
                }
                data-testid="backup-policy-retention-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="backup-policy-status">Status</Label>
              <Select
                value={draft.status}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, status: value as PolicyDraft["status"] }))
                }
              >
                <SelectTrigger id="backup-policy-status" data-testid="backup-policy-status-select">
                  {draft.status}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="paused">paused</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr,auto]">
            <div className="grid gap-2">
              <Label htmlFor="backup-policy-schedule">Schedule</Label>
              <Input
                id="backup-policy-schedule"
                value={draft.schedule}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, schedule: event.target.value }))
                }
                placeholder="0 2 * * *"
                data-testid="backup-policy-schedule-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="backup-policy-turn-off">Turn off container</Label>
              <Button
                id="backup-policy-turn-off"
                variant={draft.turnOff ? "default" : "outline"}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    turnOff: !current.turnOff
                  }))
                }
                data-testid="backup-policy-turn-off-toggle"
              >
                {draft.turnOff ? "enabled" : "disabled"}
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="backup-policy-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={submitPolicy}
              disabled={submitPending}
              data-testid="backup-policy-dialog-submit"
            >
              {submitPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              {draft.id ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
