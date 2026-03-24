import { EmptyState } from "@/components/EmptyState";
import { ProjectsPageCreateDialog } from "@/components/projects-page/ProjectsPageCreateDialog";
import { ProjectsPageProjectCard } from "@/components/projects-page/ProjectsPageProjectCard";
import { ProjectsPageSearchControls } from "@/components/projects-page/ProjectsPageSearchControls";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderKanban, Plus } from "lucide-react";
import { useProjectsPage } from "./projects-page/useProjectsPage";

export const ProjectCard = ProjectsPageProjectCard;

export default function ProjectsPage() {
  const page = useProjectsPage();

  return (
    <main className="shell space-y-6" data-testid="projects-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Manage your Docker and Compose deployment projects.
          </p>
        </div>

        <ProjectsPageCreateDialog
          open={page.dialogOpen}
          draft={page.newProject}
          isPending={page.createProject.isPending}
          errorMessage={page.createProject.error?.message}
          onOpenChange={page.handleDialogOpenChange}
          onDraftChange={page.handleNewProjectChange}
          onSubmit={page.handleCreateProjectSubmit}
        />
      </div>

      {page.showSearchControls ? (
        <ProjectsPageSearchControls
          searchInput={page.searchInput}
          sortBy={page.sortBy}
          onSearchInputChange={page.handleSearchInputChange}
          onSortChange={page.setSortBy}
        />
      ) : null}

      {page.projectsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : !page.hasProjects ? (
        <EmptyState
          action={
            <Button
              data-testid="projects-empty-create-project"
              size="lg"
              onClick={() => page.handleDialogOpenChange(true)}
            >
              <Plus size={18} className="mr-2" />
              Create your first project
            </Button>
          }
          data-testid="projects-empty-state"
          description="Create a project to organize environments, attach a repository or Compose source, and start shipping services from one control plane."
          eyebrow="First deployment"
          footer={
            <ol className="grid gap-3 text-left sm:grid-cols-3">
              <li className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                <p className="text-sm font-medium text-foreground">Define the project</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Start with a name, optional description, and repository link.
                </p>
              </li>
              <li className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                <p className="text-sm font-medium text-foreground">Add environments</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Split staging, production, or internal workloads without duplicating setup.
                </p>
              </li>
              <li className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                <p className="text-sm font-medium text-foreground">Connect deployments</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Attach Docker, Compose, or Git-backed sources once the project exists.
                </p>
              </li>
            </ol>
          }
          icon={<FolderKanban size={30} className="text-primary/60" />}
          title="Create your first project"
        />
      ) : page.sortedProjects.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
            <FolderKanban size={28} className="text-primary/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {page.search ? "No matching projects" : "No projects yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {page.search
                ? "Try a different search term."
                : "Create your first project to get started."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.sortedProjects.map((project) => (
            <ProjectsPageProjectCard
              key={String(project.id)}
              project={project}
              onOpenProject={page.handleOpenProject}
            />
          ))}
        </div>
      )}
    </main>
  );
}
