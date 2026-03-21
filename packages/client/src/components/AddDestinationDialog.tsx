import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { AddDestinationProviderFields } from "@/components/destinations/AddDestinationProviderFields";
import {
  buildDestinationPayload,
  createInitialAddDestinationFormState,
  getAuthorizeCommand,
  getDefaultDestinationName
} from "@/components/destinations/add-destination-payload";
import {
  DESTINATION_PROVIDERS,
  type ProviderKey
} from "@/components/destinations/add-destination-provider-config";
import type {
  AddDestinationFormState,
  DestinationFormData
} from "@/components/destinations/add-destination-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";

export type { DestinationFormData } from "@/components/destinations/add-destination-types";

interface AddDestinationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: DestinationFormData) => void;
  isPending: boolean;
}

export function AddDestinationDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending
}: AddDestinationDialogProps) {
  const [form, setForm] = useState(createInitialAddDestinationFormState);
  const [copied, setCopied] = useState(false);

  const updateField = useCallback((field: keyof AddDestinationFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const handleProviderChange = useCallback((v: string) => {
    const key = v as ProviderKey;
    setForm((current) => ({
      ...current,
      provider: key,
      name: current.name || getDefaultDestinationName(key)
    }));
    setCopied(false);
  }, []);

  const authorizeCmd = getAuthorizeCommand(form.provider);

  function copyCommand() {
    if (!authorizeCmd) return;
    void navigator.clipboard.writeText(authorizeCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleSubmit() {
    onSubmit(buildDestinationPayload(form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="destination-add-button">
          <Plus size={16} /> Add Destination
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" data-testid="destination-dialog">
        <DialogHeader>
          <DialogTitle>Add Backup Destination</DialogTitle>
          <DialogDescription>
            Configure a new storage target for backups. Test connectivity before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="dest-name">Name</Label>
            <Input
              id="dest-name"
              data-testid="destination-name"
              placeholder="My S3 Bucket"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="destination-provider">Provider</Label>
            <Select value={form.provider} onValueChange={handleProviderChange}>
              <SelectTrigger
                id="destination-provider"
                aria-label="Provider"
                data-testid="destination-provider-select"
              >
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {DESTINATION_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.key} value={provider.key}>
                    {provider.icon} {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AddDestinationProviderFields
            form={form}
            copied={copied}
            authorizeCommand={authorizeCmd}
            onCopyAuthorizeCommand={copyCommand}
            onFieldChange={updateField}
          />
        </div>

        <DialogFooter>
          <Button
            data-testid="destination-create-button"
            variant="outline"
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending ? "Creating…" : "Create Destination"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
