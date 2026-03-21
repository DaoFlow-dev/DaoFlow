import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AddServiceDialog from "../components/AddServiceDialog";
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
  const page = useProjectDetailPage(id, navigate);

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
        createPending={page.createEnvironment.isPending}
        updatePending={page.updateEnvironment.isPending}
        deletePending={page.deleteEnvironment.isPending}
        errorMessage={page.environmentErrorMessage}
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
      />

      {id ? (
        <AddServiceDialog
          open={page.showAddService}
          onOpenChange={page.setShowAddService}
          projectId={id}
          environments={project.environments ?? []}
          onCreated={() => void page.services.refetch()}
        />
      ) : null}
    </div>
  );
}
