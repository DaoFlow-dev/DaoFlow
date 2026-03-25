import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Server } from "lucide-react";
import { SetupWizardStepLayout } from "./SetupWizardStepLayout";
import type { SetupServerFormData } from "./setup-wizard-types";

interface SetupServerStepProps {
  steps: Array<{
    label: string;
    completed: boolean;
    active: boolean;
  }>;
  value: SetupServerFormData;
  feedback: string | null;
  isPending: boolean;
  onChange: (field: keyof SetupServerFormData, value: string) => void;
  onSubmit: () => void;
}

export function SetupServerStep({
  steps,
  value,
  feedback,
  isPending,
  onChange,
  onSubmit
}: SetupServerStepProps) {
  return (
    <SetupWizardStepLayout
      badge="Step 2 of 5"
      title={
        <span className="flex items-center gap-2">
          <Server size={20} /> Register Your First Server
        </span>
      }
      description="Connect a Docker host that DaoFlow will manage via SSH."
      stepItems={steps}
      testId="setup-server-step"
    >
      {feedback ? (
        <div
          className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="setup-server-feedback"
        >
          {feedback}
        </div>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="setup-server-name">Server Name</Label>
          <Input
            id="setup-server-name"
            value={value.name}
            onChange={(event) => onChange("name", event.target.value)}
            placeholder="my-vps-1"
            data-testid="setup-server-name"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-server-host">Host (IP or hostname)</Label>
          <Input
            id="setup-server-host"
            value={value.host}
            onChange={(event) => onChange("host", event.target.value)}
            placeholder="203.0.113.10"
            data-testid="setup-server-host"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="setup-server-port">SSH Port</Label>
            <Input
              id="setup-server-port"
              type="number"
              value={value.sshPort}
              onChange={(event) => onChange("sshPort", event.target.value)}
              data-testid="setup-server-port"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-server-region">Region</Label>
            <Input
              id="setup-server-region"
              value={value.region}
              onChange={(event) => onChange("region", event.target.value)}
              placeholder="us-west-2"
              data-testid="setup-server-region"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-server-user">SSH User</Label>
          <Input
            id="setup-server-user"
            value={value.sshUser}
            onChange={(event) => onChange("sshUser", event.target.value)}
            placeholder="root"
            data-testid="setup-server-user"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-server-key">SSH Private Key</Label>
          <Textarea
            id="setup-server-key"
            value={value.sshPrivateKey}
            onChange={(event) => onChange("sshPrivateKey", event.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            rows={8}
            data-testid="setup-server-key"
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isPending}
          data-testid="setup-server-submit"
        >
          {isPending ? "Registering..." : "Continue to Project Setup →"}
        </Button>
      </form>
    </SetupWizardStepLayout>
  );
}
