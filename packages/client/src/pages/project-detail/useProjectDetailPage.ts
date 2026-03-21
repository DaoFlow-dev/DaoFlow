import { useCallback, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { trpc } from "../../lib/trpc";
import {
  countServiceHealth,
  getActiveEnvironmentName,
  getFilteredServices,
  getLastProjectDeployment,
  getProjectConfig,
  getProjectDescription
} from "./project-detail-helpers";
import type {
  ProjectDetailDeployment,
  ProjectDetailEnvironment,
  ProjectDetailProject,
  ProjectDetailServer,
  ProjectDetailService
} from "./project-detail-types";

export function useProjectDetailPage(projectId: string | undefined, navigate: NavigateFunction) {
  const utils = trpc.useUtils();
  const [showAddService, setShowAddService] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const project = trpc.projectDetails.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId) }
  );
  const services = trpc.projectServices.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId) }
  );
  const environments = trpc.projectEnvironments.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId) }
  );
  const infrastructure = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(projectId)
  });
  const deployments = trpc.recentDeployments.useQuery({ limit: 20 });

  const refreshProjectViews = useCallback(async () => {
    await Promise.all([
      project.refetch(),
      services.refetch(),
      environments.refetch(),
      utils.projects.invalidate()
    ]);
  }, [environments, project, services, utils.projects]);

  const updateProject = trpc.updateProject.useMutation({
    onSuccess: async () => {
      await Promise.all([project.refetch(), utils.projects.invalidate()]);
      setShowSettings(false);
    }
  });
  const deleteProject = trpc.deleteProject.useMutation({
    onSuccess: async () => {
      await utils.projects.invalidate();
      setShowDeleteDialog(false);
      void navigate("/projects");
    }
  });
  const createEnvironment = trpc.createEnvironment.useMutation({
    onSuccess: async () => {
      await refreshProjectViews();
    }
  });
  const updateEnvironment = trpc.updateEnvironment.useMutation({
    onSuccess: async () => {
      await refreshProjectViews();
    }
  });
  const deleteEnvironment = trpc.deleteEnvironment.useMutation({
    onSuccess: async (_, variables) => {
      if (variables.environmentId === activeEnv) {
        setActiveEnv(null);
      }
      await refreshProjectViews();
    }
  });

  const projectData = project.data as ProjectDetailProject | undefined;
  const config = useMemo(() => getProjectConfig(projectData?.config), [projectData?.config]);
  const projectDescription = useMemo(() => getProjectDescription(config), [config]);

  const serviceList = useMemo(
    () => (services.data ?? []) as ProjectDetailService[],
    [services.data]
  );
  const environmentList = useMemo(
    () => (environments.data ?? []) as ProjectDetailEnvironment[],
    [environments.data]
  );
  const serverList = ((infrastructure.data?.servers ?? []) as ProjectDetailServer[]).map(
    (server) => ({
      id: server.id,
      name: server.name,
      host: server.host
    })
  );
  const deploymentList = useMemo(
    () => (deployments.data ?? []) as ProjectDetailDeployment[],
    [deployments.data]
  );

  const filteredServices = useMemo(
    () => getFilteredServices(serviceList, activeEnv),
    [activeEnv, serviceList]
  );
  const environmentErrorMessage =
    createEnvironment.error?.message ??
    updateEnvironment.error?.message ??
    deleteEnvironment.error?.message ??
    null;
  const healthCounts = useMemo(() => countServiceHealth(serviceList), [serviceList]);
  const lastDeploy = useMemo(
    () => getLastProjectDeployment(deploymentList, serviceList),
    [deploymentList, serviceList]
  );
  const activeEnvironmentName = useMemo(
    () => getActiveEnvironmentName(environmentList, activeEnv),
    [activeEnv, environmentList]
  );
  const trimmedEditName = editName.trim();
  const normalizedEditDesc = editDesc.trim();
  const saveDisabled =
    !projectData ||
    !trimmedEditName ||
    updateProject.isPending ||
    deleteProject.isPending ||
    (trimmedEditName === projectData.name && normalizedEditDesc === projectDescription);

  const toggleSettings = useCallback(() => {
    if (!projectData) {
      return;
    }

    updateProject.reset();
    setShowSettings((current) => !current);
    setEditName(projectData.name);
    setEditDesc(projectDescription);
  }, [projectData, projectDescription, updateProject]);

  const copyProjectId = useCallback(() => {
    if (!projectData) {
      return;
    }

    void navigator.clipboard.writeText(projectData.id).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  }, [projectData]);

  const saveProjectSettings = useCallback(() => {
    if (!projectData) {
      return;
    }

    updateProject.mutate({
      projectId: projectData.id,
      name: trimmedEditName,
      description: normalizedEditDesc
    });
  }, [normalizedEditDesc, projectData, trimmedEditName, updateProject]);

  const requestProjectDelete = useCallback(() => {
    deleteProject.reset();
    setShowDeleteDialog(true);
  }, [deleteProject]);

  const confirmProjectDelete = useCallback(() => {
    if (!projectData || deleteProject.isPending) {
      return;
    }

    deleteProject.mutate({ projectId: projectData.id });
  }, [deleteProject, projectData]);

  const resetEnvironmentMutations = useCallback(() => {
    createEnvironment.reset();
    updateEnvironment.reset();
    deleteEnvironment.reset();
  }, [createEnvironment, deleteEnvironment, updateEnvironment]);

  return {
    project,
    projectData,
    config,
    projectDescription,
    services,
    serviceList,
    filteredServices,
    environments: environmentList,
    servers: serverList,
    activeEnv,
    activeEnvironmentName,
    setActiveEnv,
    showAddService,
    setShowAddService,
    showSettings,
    toggleSettings,
    showDeleteDialog,
    setShowDeleteDialog,
    editName,
    setEditName,
    editDesc,
    setEditDesc,
    copiedId,
    copyProjectId,
    updateProject,
    deleteProject,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    saveProjectSettings,
    requestProjectDelete,
    confirmProjectDelete,
    resetEnvironmentMutations,
    environmentErrorMessage,
    healthyCount: healthCounts.healthy,
    unhealthyCount: healthCounts.unhealthy,
    lastDeploy,
    saveDisabled
  };
}
