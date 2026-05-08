import { Link } from "react-router-dom";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetupWizardStepLayout } from "./setup-wizard/SetupWizardStepLayout";
import { SetupEnvironmentStep } from "./setup-wizard/SetupEnvironmentStep";
import { SetupHandoffStep } from "./setup-wizard/SetupHandoffStep";
import { SetupProjectStep } from "./setup-wizard/SetupProjectStep";
import { SetupServerStep } from "./setup-wizard/SetupServerStep";
import { useSetupWizardState } from "./setup-wizard/use-setup-wizard-state";

export default function SetupWizardPage() {
  const wizard = useSetupWizardState();

  if (wizard.step === "welcome") {
    return (
      <SetupWizardStepLayout
        title="Welcome to DaoFlow"
        description="Set up your owner account, first server, first project, and first environment in one guided flow."
        className="max-w-xl"
        contentClassName="space-y-4 text-center"
        testId="setup-welcome-step"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Rocket size={24} className="text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">
          The goal is to end setup at a real deployment target instead of dropping you into a
          generic dashboard.
        </p>
        <Button
          size="lg"
          onClick={() =>
            wizard.updateSearchState(wizard.isAuthenticated ? wizard.resumeStep : "account")
          }
          data-testid="setup-welcome-continue"
        >
          {wizard.isAuthenticated ? "Continue Setup →" : "Create Your Account →"}
        </Button>
      </SetupWizardStepLayout>
    );
  }

  if (wizard.step === "account") {
    return (
      <SetupWizardStepLayout
        badge="Step 1 of 5"
        title="Create Owner Account"
        description="Create or sign in to your owner account before registering the first server."
        stepItems={wizard.stepItems}
        testId="setup-account-step"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your first authenticated account becomes the platform owner. After login you will return
            directly to the next setup step.
          </p>
          <Link
            to={wizard.loginHref}
            className="inline-block"
            data-testid="setup-account-login-link"
          >
            <Button>Go to Sign In / Sign Up →</Button>
          </Link>
          {wizard.isAuthenticated ? (
            <Button
              onClick={() => wizard.updateSearchState(wizard.resumeStep)}
              data-testid="setup-account-continue"
            >
              Continue Setup →
            </Button>
          ) : null}
        </div>
      </SetupWizardStepLayout>
    );
  }

  if (wizard.step === "server") {
    return (
      <SetupServerStep
        steps={wizard.stepItems}
        value={wizard.serverForm}
        feedback={wizard.serverFeedback}
        isPending={wizard.registerServerPending}
        onChange={wizard.onServerChange}
        onSubmit={wizard.onServerSubmit}
      />
    );
  }

  if (wizard.step === "project") {
    return (
      <SetupProjectStep
        steps={wizard.stepItems}
        value={wizard.projectForm}
        gitProviders={wizard.gitProviders}
        gitInstallations={wizard.gitInstallations}
        feedback={wizard.projectFeedback}
        isPending={wizard.createProjectPending}
        onChange={wizard.onProjectChange}
        onSubmit={wizard.onProjectSubmit}
      />
    );
  }

  if (wizard.step === "environment") {
    return (
      <SetupEnvironmentStep
        steps={wizard.stepItems}
        value={wizard.environmentForm}
        servers={wizard.servers}
        feedback={wizard.environmentFeedback}
        isPending={wizard.createEnvironmentPending}
        onChange={wizard.onEnvironmentChange}
        onSubmit={wizard.onEnvironmentSubmit}
      />
    );
  }

  return (
    <SetupHandoffStep
      steps={[
        ...wizard.stepItems.map((item) => ({
          ...item,
          completed: true,
          active: false
        })),
        {
          label: "Deploy",
          completed: false,
          active: true
        }
      ]}
      projectName={wizard.handoffProjectName}
      environmentName={wizard.handoffEnvironmentName}
      serverName={wizard.handoffServerName}
      addServiceHref={wizard.addServiceHref}
      deployHref={wizard.deployHref}
      projectHref={wizard.projectHref}
    />
  );
}
