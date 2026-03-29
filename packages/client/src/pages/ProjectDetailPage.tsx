import { useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AddServiceDialog from "../components/AddServiceDialog";
import type { EnvironmentRecord } from "@/components/project/project-environments-panel/types";
import { ProjectDetailHeader } from "@/components/project/ProjectDetailHeader";
import { ProjectEnvironmentFilter } from "@/components/project/ProjectEnvironmentFilter";
import { ProjectOverviewCards } from "@/components/project/ProjectOverviewCards";
import { ProjectEnvironmentsPanel } from "@/components/project/ProjectEnvironmentsPanel";
import { ProjectServicesList } from "@/components/project/ProjectServicesList";
import { ProjectSettingsPanel } from "@/components/project/ProjectSettingsPanel";
import { ProjectGitCard } from "@/components/project/ProjectGitCard";
import { useProjectDetailPage } from "./project-detail/useProjectDetailPage";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = useProjectDetailPage(id, navigate);
  const requestedEnvironmentId = searchParams.get("environmentId");
  const shouldOpenAddService = searchParams.get("openAddService") === "1";
  const environmentOptions = useMemo(
    () => page.projectData?.environments ?? [],
    [page.projectData?.environments]
  );
  const { setActiveEnv, setShowAddService } = page;
  const availableEnvironmentIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...environmentOptions.map((environment) => environment.id),
          ...page.environments.map((environment) => environment.id)
        ])
      ),
    [environmentOptions, page.environments]
  );

  useEffect(() => {
    if (!requestedEnvironmentId || page.activeEnv === requestedEnvironmentId) {
      return;
    }

    if (availableEnvironmentIds.includes(requestedEnvironmentId)) {
      setActiveEnv(requestedEnvironmentId);
    }
  }, [availableEnvironmentIds, page.activeEnv, requestedEnvironmentId, setActiveEnv]);

  useEffect(() => {
    if (!shouldOpenAddService) {
      return;
    }

    setShowAddService(true);

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openAddService");
    setSearchParams(nextSearchParams, { replace: true });
  }, [
    availableEnvironmentIds,
    requestedEnvironmentId,
    searchParams,
    setActiveEnv,
    setSearchParams,
    setShowAddService,
    shouldOpenAddService
  ]);

  if (page.project.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!page.projectData) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Project not found.
        <br />
        <Button variant="ghost" className="mt-4" onClick={() => void navigate("/projects")}>
          Back to Projects
        </Button>
      </div>
    );
  }

  const project = page.projectData;

  const selectedEnvironment =
    (page.activeEnv
      ? page.environments.find((environment) => environment.id === page.activeEnv)
      : undefined) ??
    (requestedEnvironmentId
      ? page.environments.find((environment) => environment.id === requestedEnvironmentId)
      : undefined) ??
    (page.environments.length === 1 ? page.environments[0] : null);

  function buildEnvironmentDeployHref(
    source: "template" | "compose",
    environment: EnvironmentRecord
  ) {
    const params = new URLSearchParams({
      source,
      projectId: project.id,
      projectName: project.name,
      environmentId: environment.id,
      environmentName: environment.name
    });

    if (environment.targetServerId) {
      params.set("serverId", environment.targetServerId);
      const serverName = page.servers.find(
        (server) => server.id === environment.targetServerId
      )?.name;
      if (serverName) {
        params.set("serverName", serverName);
      }
    }

    return `/deploy?${params.toString()}`;
  }

  function openEnvironmentDeploy(source: "template" | "compose", environment: EnvironmentRecord) {
    void navigate(buildEnvironmentDeployHref(source, environment));
  }

  return (
    <div className="space-y-6">
      <ProjectDetailHeader
        projectId={project.id}
        projectName={project.name}
        projectDescription={page.projectDescription}
        copiedId={page.copiedId}
        showDeleteDialog={page.showDeleteDialog}
        isDeletePending={page.deleteProject.isPending}
        deleteErrorMessage={page.deleteProject.error?.message}
        onBack={() => void navigate("/projects")}
        onCopyProjectId={page.copyProjectId}
        onToggleSettings={page.toggleSettings}
        onAddService={() => page.setShowAddService(true)}
        onDeleteDialogChange={page.setShowDeleteDialog}
        onDeleteTrigger={page.requestProjectDelete}
        onConfirmDelete={page.confirmProjectDelete}
      />

      {page.showSettings ? (
        <ProjectSettingsPanel
          editName={page.editName}
          onEditName={page.setEditName}
          editDesc={page.editDesc}
          onEditDesc={page.setEditDesc}
          onSave={page.saveProjectSettings}
          onRequestDelete={page.requestProjectDelete}
          isSaving={page.updateProject.isPending}
          isDeletePending={page.deleteProject.isPending}
          saveDisabled={page.saveDisabled}
          errorMessage={page.updateProject.error?.message}
        />
      ) : null}

      <ProjectGitCard
        config={page.config}
        repoUrl={project.repoUrl}
        repoFullName={project.repoFullName}
        defaultBranch={project.defaultBranch}
        autoDeploy={project.autoDeploy}
      />

      <ProjectOverviewCards
        serviceCount={page.serviceList.length}
        healthyCount={page.healthyCount}
        unhealthyCount={page.unhealthyCount}
        envCount={page.environments.length}
        lastDeploy={page.lastDeploy}
      />

      <ProjectEnvironmentsPanel
        projectId={project.id}
        environments={page.environments}
        servers={page.servers}
        activeEnvironmentId={page.activeEnv}
        createPending={page.createEnvironment.isPending}
        updatePending={page.updateEnvironment.isPending}
        deletePending={page.deleteEnvironment.isPending}
        errorMessage={page.environmentErrorMessage}
        onActiveEnvironmentChange={page.setActiveEnv}
        onOpenDeploy={openEnvironmentDeploy}
        onCreate={(input) => {
          page.resetEnvironmentMutations();
          page.createEnvironment.mutate({
            projectId: input.projectId,
            name: input.name,
            targetServerId: input.targetServerId || undefined,
            composeFiles: input.composeFiles?.length ? input.composeFiles : undefined,
            composeProfiles: input.composeProfiles?.length ? input.composeProfiles : undefined
          });
        }}
        onUpdate={(input) => {
          page.resetEnvironmentMutations();
          page.updateEnvironment.mutate({
            environmentId: input.environmentId,
            name: input.name,
            status: input.status,
            targetServerId: input.targetServerId,
            composeFiles: input.composeFiles,
            composeProfiles: input.composeProfiles
          });
        }}
        onDelete={(environmentId) => {
          page.resetEnvironmentMutations();
          page.deleteEnvironment.mutate({ environmentId });
        }}
      />

      <ProjectEnvironmentFilter
        activeEnvironmentId={page.activeEnv}
        environments={page.environments}
        onEnvironmentChange={page.setActiveEnv}
      />

      <ProjectServicesList
        services={page.filteredServices}
        isLoading={page.services.isLoading}
        activeEnv={page.activeEnv}
        activeEnvName={page.activeEnvironmentName}
        onCreateService={page.environments.length > 0 ? () => setShowAddService(true) : undefined}
        deployHref={
          selectedEnvironment ? buildEnvironmentDeployHref("template", selectedEnvironment) : null
        }
      />

      {id ? (
        <AddServiceDialog
          open={page.showAddService}
          onOpenChange={setShowAddService}
          projectId={id}
          environments={environmentOptions}
          initialEnvironmentId={page.activeEnv ?? requestedEnvironmentId ?? undefined}
          onCreated={() => void page.services.refetch()}
        />
      ) : null}
    </div>
  );
}
