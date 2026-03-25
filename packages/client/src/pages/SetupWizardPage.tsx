import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetupWizardStepLayout } from "./setup-wizard/SetupWizardStepLayout";
import { SetupEnvironmentStep } from "./setup-wizard/SetupEnvironmentStep";
import { SetupHandoffStep } from "./setup-wizard/SetupHandoffStep";
import { SetupProjectStep } from "./setup-wizard/SetupProjectStep";
import { SetupServerStep } from "./setup-wizard/SetupServerStep";
import type {
  SetupEnvironmentFormData,
  SetupProjectFormData,
  SetupServerFormData,
  SetupServerOption,
  SetupStep
} from "./setup-wizard/setup-wizard-types";
import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";

const STEP_ORDER: SetupStep[] = [
  "welcome",
  "account",
  "server",
  "project",
  "environment",
  "handoff"
];

const PROTECTED_STEPS = new Set<SetupStep>(["server", "project", "environment", "handoff"]);

const DEFAULT_SERVER_FORM: SetupServerFormData = {
  name: "",
  host: "",
  sshPort: "22",
  region: "",
  sshUser: "root",
  sshPrivateKey: ""
};

const DEFAULT_PROJECT_FORM: SetupProjectFormData = {
  name: "",
  description: "",
  repoUrl: ""
};

const DEFAULT_ENVIRONMENT_FORM: SetupEnvironmentFormData = {
  name: "production",
  targetServerId: ""
};

function readStep(searchParams: URLSearchParams): SetupStep {
  const requestedStep = searchParams.get("step");

  if (requestedStep && STEP_ORDER.includes(requestedStep as SetupStep)) {
    return requestedStep as SetupStep;
  }

  return "welcome";
}

function buildStepItems(currentStep: SetupStep) {
  const guidedSteps: Array<{
    id: Exclude<SetupStep, "welcome" | "handoff">;
    label: string;
  }> = [
    { id: "account", label: "Account" },
    { id: "server", label: "Server" },
    { id: "project", label: "Project" },
    { id: "environment", label: "Environment" }
  ];

  const activeIndex = STEP_ORDER.indexOf(currentStep);

  return guidedSteps.map((step) => {
    const stepIndex = STEP_ORDER.indexOf(step.id);

    return {
      label: step.label,
      completed: activeIndex > stepIndex,
      active: currentStep === step.id
    };
  });
}

function readPersistedName(value: string | null, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export default function SetupWizardPage() {
  const session = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const step = readStep(searchParams);
  const serverId = searchParams.get("serverId") ?? "";
  const serverName = searchParams.get("serverName") ?? "";
  const projectId = searchParams.get("projectId") ?? "";
  const projectName = searchParams.get("projectName") ?? "";
  const environmentId = searchParams.get("environmentId") ?? "";
  const environmentName = searchParams.get("environmentName") ?? "";
  const stepItems = buildStepItems(step);

  const [serverForm, setServerForm] = useState<SetupServerFormData>(DEFAULT_SERVER_FORM);
  const [projectForm, setProjectForm] = useState<SetupProjectFormData>({
    ...DEFAULT_PROJECT_FORM,
    name: projectName
  });
  const [environmentForm, setEnvironmentForm] = useState<SetupEnvironmentFormData>({
    ...DEFAULT_ENVIRONMENT_FORM,
    name: readPersistedName(environmentName, DEFAULT_ENVIRONMENT_FORM.name),
    targetServerId: serverId
  });
  const [serverFeedback, setServerFeedback] = useState<string | null>(null);
  const [projectFeedback, setProjectFeedback] = useState<string | null>(null);
  const [environmentFeedback, setEnvironmentFeedback] = useState<string | null>(null);

  const infrastructureInventory = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });

  const knownServers = (
    (infrastructureInventory.data?.servers ?? []) as Array<{
      id: string;
      name: string;
      host?: string | null;
      targetKind?: string | null;
    }>
  ).map(
    (server): SetupServerOption => ({
      id: server.id,
      name: server.name,
      host: server.host ?? "unknown host",
      targetKind: server.targetKind ?? "docker-engine"
    })
  );

  const servers = useMemo(() => {
    if (!serverId || knownServers.some((server) => server.id === serverId)) {
      return knownServers;
    }

    return [
      {
        id: serverId,
        name: readPersistedName(serverName, "Configured server"),
        host: serverForm.host || "pending inventory refresh",
        targetKind: "docker-engine"
      },
      ...knownServers
    ];
  }, [knownServers, serverForm.host, serverId, serverName]);

  const updateSearchState = useCallback(
    (nextStep: SetupStep, updates?: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams);

      if (nextStep === "welcome") {
        next.delete("step");
      } else {
        next.set("step", nextStep);
      }

      if (updates) {
        for (const [key, value] of Object.entries(updates)) {
          if (value && value.trim().length > 0) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
        }
      }

      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const registerServer = trpc.registerServer.useMutation({
    onSuccess: (server) => {
      setServerFeedback(null);
      setEnvironmentForm((current) => ({
        ...current,
        targetServerId: server.id
      }));
      void infrastructureInventory.refetch();
      updateSearchState("project", {
        serverId: server.id,
        serverName: server.name,
        projectId: null,
        projectName: null,
        environmentId: null,
        environmentName: null
      });
    },
    onError: (error) => setServerFeedback(error.message)
  });

  const createProject = trpc.createProject.useMutation({
    onSuccess: (project) => {
      setProjectFeedback(null);
      updateSearchState("environment", {
        projectId: project.id,
        projectName: project.name,
        environmentId: null,
        environmentName: null
      });
    },
    onError: (error) => setProjectFeedback(error.message)
  });

  const createEnvironment = trpc.createEnvironment.useMutation({
    onSuccess: (environment) => {
      const targetServerName =
        servers.find((server) => server.id === environmentForm.targetServerId)?.name ??
        readPersistedName(serverName, serverForm.name);

      setEnvironmentFeedback(null);
      updateSearchState("handoff", {
        serverId: environmentForm.targetServerId,
        serverName: targetServerName,
        environmentId: environment.id,
        environmentName: environment.name
      });
    },
    onError: (error) => setEnvironmentFeedback(error.message)
  });

  useEffect(() => {
    if (!projectForm.name && projectName) {
      setProjectForm((current) => ({
        ...current,
        name: projectName
      }));
    }
  }, [projectForm.name, projectName]);

  useEffect(() => {
    if (!environmentForm.targetServerId) {
      const fallbackServerId = serverId || servers[0]?.id || "";
      if (!fallbackServerId) {
        return;
      }

      setEnvironmentForm((current) => ({
        ...current,
        targetServerId: fallbackServerId
      }));
    }
  }, [environmentForm.targetServerId, serverId, servers]);

  useEffect(() => {
    if (!environmentName || environmentForm.name === environmentName) {
      return;
    }

    setEnvironmentForm((current) => ({
      ...current,
      name: environmentName
    }));
  }, [environmentForm.name, environmentName]);

  useEffect(() => {
    if (!session.isPending && !session.data && PROTECTED_STEPS.has(step)) {
      updateSearchState("account");
    }
  }, [session.data, session.isPending, step, updateSearchState]);

  useEffect(() => {
    if (step === "project" && !serverId) {
      updateSearchState("server");
      return;
    }

    if (step === "environment" && !projectId) {
      updateSearchState(serverId ? "project" : "server");
      return;
    }

    if (step === "handoff") {
      if (!projectId) {
        updateSearchState(serverId ? "project" : "server");
        return;
      }

      if (!environmentId) {
        updateSearchState("environment");
      }
    }
  }, [environmentId, projectId, serverId, step, updateSearchState]);

  const resumeStep: SetupStep = environmentId
    ? "handoff"
    : projectId
      ? "environment"
      : serverId
        ? "project"
        : "server";
  const resumeParams = new URLSearchParams(searchParams);
  resumeParams.set("step", resumeStep);
  const loginHref = `/login?returnTo=${encodeURIComponent(`/setup?${resumeParams.toString()}`)}`;

  const handoffProjectName = readPersistedName(projectName, projectForm.name || "New project");
  const handoffEnvironmentName = readPersistedName(
    environmentName,
    environmentForm.name || DEFAULT_ENVIRONMENT_FORM.name
  );
  const handoffServerId = environmentForm.targetServerId || serverId;
  const handoffServerName =
    servers.find((server) => server.id === handoffServerId)?.name ??
    readPersistedName(serverName, serverForm.name || "Selected server");
  const deployParams = new URLSearchParams({
    serverId: handoffServerId,
    serverName: handoffServerName,
    projectId,
    projectName: handoffProjectName,
    environmentId,
    environmentName: handoffEnvironmentName
  });

  if (step === "welcome") {
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
          onClick={() => updateSearchState(session.data ? resumeStep : "account")}
          data-testid="setup-welcome-continue"
        >
          {session.data ? "Continue Setup →" : "Create Your Account →"}
        </Button>
      </SetupWizardStepLayout>
    );
  }

  if (step === "account") {
    return (
      <SetupWizardStepLayout
        badge="Step 1 of 5"
        title="Create Owner Account"
        description="Create or sign in to your owner account before registering the first server."
        stepItems={stepItems}
        testId="setup-account-step"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your first authenticated account becomes the platform owner. After login you will return
            directly to the next setup step.
          </p>
          <Link to={loginHref} className="inline-block" data-testid="setup-account-login-link">
            <Button>Go to Sign In / Sign Up →</Button>
          </Link>
          {session.data ? (
            <Button
              onClick={() => updateSearchState(resumeStep)}
              data-testid="setup-account-continue"
            >
              Continue Setup →
            </Button>
          ) : null}
        </div>
      </SetupWizardStepLayout>
    );
  }

  if (step === "server") {
    return (
      <SetupServerStep
        steps={stepItems}
        value={serverForm}
        feedback={serverFeedback}
        isPending={registerServer.isPending}
        onChange={(field, value) => {
          setServerFeedback(null);
          setServerForm((current) => ({
            ...current,
            [field]: value
          }));
        }}
        onSubmit={() => {
          registerServer.mutate({
            name: serverForm.name,
            host: serverForm.host,
            sshPort: Number.parseInt(serverForm.sshPort, 10) || 22,
            region: serverForm.region || "default",
            sshUser: serverForm.sshUser || undefined,
            sshPrivateKey: serverForm.sshPrivateKey || undefined,
            kind: "docker-engine"
          });
        }}
      />
    );
  }

  if (step === "project") {
    return (
      <SetupProjectStep
        steps={stepItems}
        value={projectForm}
        feedback={projectFeedback}
        isPending={createProject.isPending}
        onChange={(field, value) => {
          setProjectFeedback(null);
          setProjectForm((current) => ({
            ...current,
            [field]: value
          }));
        }}
        onSubmit={() => {
          createProject.mutate({
            name: projectForm.name.trim(),
            description: projectForm.description.trim() || undefined,
            repoUrl: projectForm.repoUrl.trim() || undefined
          });
        }}
      />
    );
  }

  if (step === "environment") {
    return (
      <SetupEnvironmentStep
        steps={stepItems}
        value={environmentForm}
        servers={servers}
        feedback={environmentFeedback}
        isPending={createEnvironment.isPending}
        onChange={(field, value) => {
          setEnvironmentFeedback(null);
          setEnvironmentForm((current) => ({
            ...current,
            [field]: value
          }));
        }}
        onSubmit={() => {
          createEnvironment.mutate({
            projectId,
            name: environmentForm.name.trim(),
            targetServerId: environmentForm.targetServerId || undefined
          });
        }}
      />
    );
  }

  return (
    <SetupHandoffStep
      steps={[
        ...stepItems.map((item) => ({
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
      projectName={handoffProjectName}
      environmentName={handoffEnvironmentName}
      serverName={handoffServerName}
      deployHref={`/deploy?source=template&${deployParams.toString()}`}
      projectHref={`/projects/${projectId}`}
    />
  );
}
