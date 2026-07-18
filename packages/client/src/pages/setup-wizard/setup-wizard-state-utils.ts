import type {
  SetupEnvironmentFormData,
  SetupProjectFormData,
  SetupServerFormData,
  SetupServerOption,
  SetupStep
} from "./setup-wizard-types";

export const STEP_ORDER: SetupStep[] = [
  "welcome",
  "account",
  "server",
  "project",
  "environment",
  "handoff"
];

export const PROTECTED_STEPS = new Set<SetupStep>(["server", "project", "environment", "handoff"]);

export const DEFAULT_SERVER_FORM: SetupServerFormData = {
  name: "",
  host: "",
  sshPort: "22",
  region: "",
  sshUser: "root",
  sshPrivateKey: ""
};

export const DEFAULT_PROJECT_FORM: SetupProjectFormData = {
  name: "",
  description: "",
  repoUrl: "",
  gitProviderId: "none",
  gitInstallationId: "none",
  repoFullName: "",
  defaultBranch: "main",
  autoDeploy: "false",
  autoDeployBranch: "",
  composePath: ""
};

export const DEFAULT_ENVIRONMENT_FORM: SetupEnvironmentFormData = {
  name: "production",
  targetServerId: ""
};

export function readStep(searchParams: URLSearchParams): SetupStep {
  const requestedStep = searchParams.get("step");

  if (requestedStep && STEP_ORDER.includes(requestedStep as SetupStep)) {
    return requestedStep as SetupStep;
  }

  return "welcome";
}

export function buildStepItems(currentStep: SetupStep) {
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

export function readPersistedName(value: string | null, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function buildSetupWizardSearchParams(
  searchParams: URLSearchParams,
  nextStep: SetupStep,
  updates?: Record<string, string | null | undefined>
) {
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

  return next;
}

export function resolveResumeStep(input: {
  environmentId: string;
  projectId: string;
  serverId: string;
}): SetupStep {
  return input.environmentId
    ? "handoff"
    : input.projectId
      ? "environment"
      : input.serverId
        ? "project"
        : "server";
}

export function buildSetupLoginHref(searchParams: URLSearchParams, resumeStep: SetupStep) {
  const resumeParams = new URLSearchParams(searchParams);
  resumeParams.set("step", resumeStep);
  return `/login?returnTo=${encodeURIComponent(`/setup?${resumeParams.toString()}`)}`;
}

export function mapInfrastructureServers(
  servers: Array<{
    id: string;
    name: string;
    host?: string | null;
    targetKind?: string | null;
  }>
): SetupServerOption[] {
  return servers.map((server): SetupServerOption => ({
    id: server.id,
    name: server.name,
    host: server.host ?? "unknown host",
    targetKind: server.targetKind ?? "docker-engine"
  }));
}

export function buildSetupWizardHandoff(input: {
  environmentFormName: string;
  environmentId: string;
  environmentName: string;
  projectFormName: string;
  projectId: string;
  projectName: string;
  serverFormName: string;
  serverId: string;
  serverName: string;
  servers: SetupServerOption[];
  targetServerId: string;
}) {
  const handoffProjectName = readPersistedName(
    input.projectName,
    input.projectFormName || "New project"
  );
  const handoffEnvironmentName = readPersistedName(
    input.environmentName,
    input.environmentFormName || DEFAULT_ENVIRONMENT_FORM.name
  );
  const handoffServerId = input.targetServerId || input.serverId;
  const handoffServerName =
    input.servers.find((server) => server.id === handoffServerId)?.name ??
    readPersistedName(input.serverName, input.serverFormName || "Selected server");
  const deployParams = new URLSearchParams({
    serverId: handoffServerId,
    serverName: handoffServerName,
    projectId: input.projectId,
    projectName: handoffProjectName,
    environmentId: input.environmentId,
    environmentName: handoffEnvironmentName
  });
  const addServiceParams = new URLSearchParams({
    environmentId: input.environmentId,
    openAddService: "1"
  });

  return {
    addServiceHref: `/projects/${input.projectId}?${addServiceParams.toString()}`,
    deployHref: `/deploy?source=template&${deployParams.toString()}`,
    handoffEnvironmentName,
    handoffProjectName,
    handoffServerName,
    projectHref: `/projects/${input.projectId}`
  };
}
