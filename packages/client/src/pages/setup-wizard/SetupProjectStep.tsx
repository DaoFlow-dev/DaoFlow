import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FolderKanban } from "lucide-react";
import { SetupWizardStepLayout } from "./SetupWizardStepLayout";
import type { SetupProjectFormData } from "./setup-wizard-types";

interface SetupProjectStepProps {
  steps: Array<{
    label: string;
    completed: boolean;
    active: boolean;
  }>;
  value: SetupProjectFormData;
  feedback: string | null;
  isPending: boolean;
  onChange: (field: keyof SetupProjectFormData, value: string) => void;
  onSubmit: () => void;
}

export function SetupProjectStep({
  steps,
  value,
  feedback,
  isPending,
  onChange,
  onSubmit
}: SetupProjectStepProps) {
  return (
    <SetupWizardStepLayout
      badge="Step 3 of 5"
      title={
        <span className="flex items-center gap-2">
          <FolderKanban size={20} /> Create Your First Project
        </span>
      }
      description="Create the deployment surface that will own environments, services, and releases."
      stepItems={steps}
      testId="setup-project-step"
    >
      {feedback ? (
        <div
          className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="setup-project-feedback"
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
          <Label htmlFor="setup-project-name">Project Name</Label>
          <Input
            id="setup-project-name"
            value={value.name}
            onChange={(event) => onChange("name", event.target.value)}
            placeholder="my-first-app"
            data-testid="setup-project-name"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-project-description">Description</Label>
          <Textarea
            id="setup-project-description"
            value={value.description}
            onChange={(event) => onChange("description", event.target.value)}
            placeholder="Production web application"
            rows={4}
            data-testid="setup-project-description"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-project-repo">Repository URL (optional)</Label>
          <Input
            id="setup-project-repo"
            value={value.repoUrl}
            onChange={(event) => onChange("repoUrl", event.target.value)}
            placeholder="https://github.com/org/repo"
            data-testid="setup-project-repo"
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isPending || !value.name.trim()}
          data-testid="setup-project-submit"
        >
          {isPending ? "Creating..." : "Continue to Environment Setup →"}
        </Button>
      </form>
    </SetupWizardStepLayout>
  );
}
