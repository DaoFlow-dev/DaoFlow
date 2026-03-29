import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle, FolderKanban, Rocket } from "lucide-react";
import { SetupWizardStepLayout } from "./SetupWizardStepLayout";

interface SetupHandoffStepProps {
  steps: Array<{
    label: string;
    completed: boolean;
    active: boolean;
  }>;
  projectName: string;
  environmentName: string;
  serverName: string;
  addServiceHref: string;
  deployHref: string;
  projectHref: string;
}

export function SetupHandoffStep({
  steps,
  projectName,
  environmentName,
  serverName,
  addServiceHref,
  deployHref,
  projectHref
}: SetupHandoffStepProps) {
  return (
    <SetupWizardStepLayout
      badge="Step 5 of 5"
      title="Setup Complete"
      description="Your first target, project, and environment are ready. Move directly into deployment instead of landing in a generic dashboard."
      stepItems={steps}
      className="max-w-2xl"
      contentClassName="space-y-6"
      testId="setup-handoff-step"
    >
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle size={20} className="text-emerald-500" />
          </div>
          <div>
            <p className="font-medium text-foreground">{projectName}</p>
            <p className="text-sm text-muted-foreground">
              {environmentName} on {serverName}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
          <p className="text-sm font-medium text-foreground">Create your first service</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Open the new project with the service dialog ready so you can keep the selected
            environment and continue setup without reselecting context.
          </p>
          <Link to={addServiceHref} data-testid="setup-handoff-add-service-link">
            <Button className="mt-4 w-full">
              <FolderKanban size={16} className="mr-2" />
              Create First Service
            </Button>
          </Link>
        </div>

        <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
          <p className="text-sm font-medium text-foreground">Deploy from template</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Start with a template-backed Compose deployment so you can preview the plan before
            DaoFlow queues any work.
          </p>
          <Link to={deployHref} data-testid="setup-handoff-deploy-link">
            <Button variant="outline" className="mt-4 w-full">
              <Rocket size={16} className="mr-2" />
              Deploy from Template
            </Button>
          </Link>
        </div>
      </div>

      <div className="text-center">
        <Link
          to={projectHref}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          data-testid="setup-handoff-project-link"
        >
          Open the project overview instead
        </Link>
      </div>
    </SetupWizardStepLayout>
  );
}
