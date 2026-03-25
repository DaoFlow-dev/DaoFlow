import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Layers3 } from "lucide-react";
import { SetupWizardStepLayout } from "./SetupWizardStepLayout";
import type { SetupEnvironmentFormData, SetupServerOption } from "./setup-wizard-types";

interface SetupEnvironmentStepProps {
  steps: Array<{
    label: string;
    completed: boolean;
    active: boolean;
  }>;
  value: SetupEnvironmentFormData;
  servers: SetupServerOption[];
  feedback: string | null;
  isPending: boolean;
  onChange: (field: keyof SetupEnvironmentFormData, value: string) => void;
  onSubmit: () => void;
}

export function SetupEnvironmentStep({
  steps,
  value,
  servers,
  feedback,
  isPending,
  onChange,
  onSubmit
}: SetupEnvironmentStepProps) {
  return (
    <SetupWizardStepLayout
      badge="Step 4 of 5"
      title={
        <span className="flex items-center gap-2">
          <Layers3 size={20} /> Create Your First Environment
        </span>
      }
      description="Choose the target server and define the first environment DaoFlow will operate."
      stepItems={steps}
      testId="setup-environment-step"
    >
      {feedback ? (
        <div
          className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="setup-environment-feedback"
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
          <Label htmlFor="setup-environment-name">Environment Name</Label>
          <Input
            id="setup-environment-name"
            value={value.name}
            onChange={(event) => onChange("name", event.target.value)}
            placeholder="production"
            data-testid="setup-environment-name"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-environment-server">Target Server</Label>
          <select
            id="setup-environment-server"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={value.targetServerId}
            onChange={(event) => onChange("targetServerId", event.target.value)}
            data-testid="setup-environment-server"
          >
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name} · {server.host} · {server.targetKind}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isPending || !value.name.trim() || !value.targetServerId}
          data-testid="setup-environment-submit"
        >
          {isPending ? "Creating..." : "Continue to Deployment Handoff →"}
        </Button>
      </form>
    </SetupWizardStepLayout>
  );
}
