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
import { UNLINKED_SERVICE, type VolumeDraft } from "./volume-registry-types";

interface VolumeRegistryDialogProps {
  dialogOpen: boolean;
  draft: VolumeDraft;
  serverLabelById: Map<string, string>;
  serverOptions: Array<{ id: string; label: string }>;
  serviceLabelById: Map<string, string>;
  serviceOptions: Array<{ id: string; label: string }>;
  setDialogOpen: (open: boolean) => void;
  setDraft: Dispatch<SetStateAction<VolumeDraft>>;
  submitPending: boolean;
  submitVolume: () => void;
}

export function VolumeRegistryDialog({
  dialogOpen,
  draft,
  serverLabelById,
  serverOptions,
  serviceLabelById,
  serviceOptions,
  setDialogOpen,
  setDraft,
  submitPending,
  submitVolume
}: VolumeRegistryDialogProps) {
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle data-testid="volume-dialog-title">
            {draft.id ? "Edit Volume" : "Register Volume"}
          </DialogTitle>
          <DialogDescription>
            Link the mounted data to the right server and service so backup metadata stays stable.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="volume-name">Volume name</Label>
            <Input
              id="volume-name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              data-testid="volume-name-input"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="volume-server">Server</Label>
            <Select
              value={draft.serverId}
              onValueChange={(value) => setDraft((current) => ({ ...current, serverId: value }))}
            >
              <SelectTrigger id="volume-server" data-testid="volume-server-select">
                {serverLabelById.get(draft.serverId) ?? "Select a server"}
              </SelectTrigger>
              <SelectContent>
                {serverOptions.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    {server.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="volume-service">Service link</Label>
            <Select
              value={draft.serviceId}
              onValueChange={(value) => setDraft((current) => ({ ...current, serviceId: value }))}
            >
              <SelectTrigger id="volume-service" data-testid="volume-service-select">
                {draft.serviceId === UNLINKED_SERVICE
                  ? "Unlinked"
                  : (serviceLabelById.get(draft.serviceId) ?? "Select a service")}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNLINKED_SERVICE}>Unlinked</SelectItem>
                {serviceOptions.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="volume-mount-path">Mount path</Label>
            <Input
              id="volume-mount-path"
              value={draft.mountPath}
              onChange={(event) =>
                setDraft((current) => ({ ...current, mountPath: event.target.value }))
              }
              data-testid="volume-mount-path-input"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="volume-driver">Driver</Label>
              <Input
                id="volume-driver"
                value={draft.driver}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, driver: event.target.value }))
                }
                data-testid="volume-driver-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="volume-size">Size bytes</Label>
              <Input
                id="volume-size"
                value={draft.sizeBytes}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, sizeBytes: event.target.value }))
                }
                data-testid="volume-size-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="volume-status">Status</Label>
              <Select
                value={draft.status}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    status: value as VolumeDraft["status"]
                  }))
                }
              >
                <SelectTrigger id="volume-status" data-testid="volume-status-select">
                  {draft.status}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="inactive">inactive</SelectItem>
                  <SelectItem value="paused">paused</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="volume-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={submitVolume}
              disabled={submitPending}
              data-testid="volume-dialog-submit"
            >
              {submitPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              {draft.id ? "Save" : "Register"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
