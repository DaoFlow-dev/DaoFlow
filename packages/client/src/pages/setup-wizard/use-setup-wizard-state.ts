import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../lib/auth-client";
import { trpc } from "../../lib/trpc";
import { buildSetupProjectPayload } from "./setup-project-payload";
import {
  buildSetupLoginHref,
  buildSetupWizardSearchParams,
  buildSetupWizardHandoff,
  buildStepItems,
  DEFAULT_ENVIRONMENT_FORM,
  DEFAULT_PROJECT_FORM,
  DEFAULT_SERVER_FORM,
  mapInfrastructureServers,
  PROTECTED_STEPS,
  readPersistedName,
  readStep,
  resolveResumeStep
} from "./setup-wizard-state-utils";
import type {
  SetupEnvironmentFormData,
  SetupProjectFormData,
  SetupServerFormData,
  SetupStep
} from "./setup-wizard-types";

export function useSetupWizardState() {
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
  const gitProvidersQuery = trpc.gitProviders.useQuery(undefined, {
    enabled: Boolean(session.data) && step === "project"
  });
  const selectedGitProviderId =
    projectForm.gitProviderId !== "none" ? projectForm.gitProviderId : undefined;
  const gitInstallationsQuery = trpc.gitInstallations.useQuery(
    { providerId: selectedGitProviderId },
    { enabled: Boolean(session.data) && step === "project" && Boolean(selectedGitProviderId) }
  );

  const knownServers = useMemo(
    () => mapInfrastructureServers(infrastructureInventory.data?.servers ?? []),
    [infrastructureInventory.data?.servers]
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
      setSearchParams(buildSetupWizardSearchParams(searchParams, nextStep, updates), {
        replace: true
      });
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

  const resumeStep = resolveResumeStep({ environmentId, projectId, serverId });
  const loginHref = buildSetupLoginHref(searchParams, resumeStep);

  const handoff = buildSetupWizardHandoff({
    environmentFormName: environmentForm.name,
    environmentId,
    environmentName,
    projectId,
    projectFormName: projectForm.name,
    projectName,
    serverFormName: serverForm.name,
    serverId,
    serverName,
    servers,
    targetServerId: environmentForm.targetServerId
  });

  return {
    addServiceHref: handoff.addServiceHref,
    createEnvironmentPending: createEnvironment.isPending,
    createProjectPending: createProject.isPending,
    deployHref: handoff.deployHref,
    environmentFeedback,
    environmentForm,
    gitInstallations: gitInstallationsQuery.data ?? [],
    gitProviders: gitProvidersQuery.data ?? [],
    handoffEnvironmentName: handoff.handoffEnvironmentName,
    handoffProjectName: handoff.handoffProjectName,
    handoffServerName: handoff.handoffServerName,
    isAuthenticated: Boolean(session.data),
    loginHref,
    onEnvironmentChange: (field: keyof SetupEnvironmentFormData, value: string) => {
      setEnvironmentFeedback(null);
      setEnvironmentForm((current) => ({
        ...current,
        [field]: value
      }));
    },
    onEnvironmentSubmit: () => {
      createEnvironment.mutate({
        projectId,
        name: environmentForm.name.trim(),
        targetServerId: environmentForm.targetServerId || undefined
      });
    },
    onProjectChange: (field: keyof SetupProjectFormData, value: string) => {
      setProjectFeedback(null);
      setProjectForm((current) => ({
        ...current,
        [field]: value,
        ...(field === "gitProviderId" ? { gitInstallationId: "none" } : {})
      }));
    },
    onProjectSubmit: () => {
      createProject.mutate(buildSetupProjectPayload(projectForm));
    },
    onServerChange: (field: keyof SetupServerFormData, value: string) => {
      setServerFeedback(null);
      setServerForm((current) => ({
        ...current,
        [field]: value
      }));
    },
    onServerSubmit: () => {
      registerServer.mutate({
        name: serverForm.name,
        host: serverForm.host,
        sshPort: Number.parseInt(serverForm.sshPort, 10) || 22,
        region: serverForm.region || "default",
        sshUser: serverForm.sshUser || undefined,
        sshPrivateKey: serverForm.sshPrivateKey || undefined,
        kind: "docker-engine"
      });
    },
    projectFeedback,
    projectForm,
    projectHref: handoff.projectHref,
    registerServerPending: registerServer.isPending,
    resumeStep,
    serverFeedback,
    serverForm,
    servers,
    step,
    stepItems,
    updateSearchState
  };
}
