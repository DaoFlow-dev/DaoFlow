import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

export interface RegisterServerFormData {
  name: string;
  host: string;
  region: string;
  sshPort: number;
  sshUser?: string;
  sshPrivateKey?: string;
  kind: "docker-engine";
}

interface RegisterServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: RegisterServerFormData) => void;
  isPending: boolean;
}

export function RegisterServerDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending
}: RegisterServerDialogProps) {
  const [form, setForm] = useState({
    name: "",
    host: "",
    region: "",
    sshPort: "22",
    sshUser: "root",
    sshPrivateKey: ""
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus size={16} /> Add Server
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Server</DialogTitle>
          <DialogDescription>
            Add a Docker target that DaoFlow can reach over SSH.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({
              name: form.name.trim(),
              host: form.host.trim(),
              region: form.region.trim() || "default",
              sshPort: Number.parseInt(form.sshPort, 10) || 22,
              sshUser: form.sshUser.trim() || undefined,
              sshPrivateKey: form.sshPrivateKey.trim() || undefined,
              kind: "docker-engine"
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="server-name">Name</Label>
            <Input
              id="server-name"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="edge-vps-1"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="server-host">Host</Label>
            <Input
              id="server-host"
              value={form.host}
              onChange={(event) =>
                setForm((current) => ({ ...current, host: event.target.value }))
              }
              placeholder="203.0.113.42"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="server-region">Region</Label>
              <Input
                id="server-region"
                value={form.region}
                onChange={(event) =>
                  setForm((current) => ({ ...current, region: event.target.value }))
                }
                placeholder="us-west-2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-ssh-port">SSH Port</Label>
              <Input
                id="server-ssh-port"
                type="number"
                value={form.sshPort}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sshPort: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="server-ssh-user">SSH User</Label>
            <Input
              id="server-ssh-user"
              value={form.sshUser}
              onChange={(event) =>
                setForm((current) => ({ ...current, sshUser: event.target.value }))
              }
              placeholder="root"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="server-ssh-key">SSH Private Key</Label>
            <Textarea
              id="server-ssh-key"
              value={form.sshPrivateKey}
              onChange={(event) =>
                setForm((current) => ({ ...current, sshPrivateKey: event.target.value }))
              }
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              rows={8}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Registering…" : "Register Server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
