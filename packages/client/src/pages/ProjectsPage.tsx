import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { FolderKanban, Plus, Search, Loader2, ArrowUpDown } from "lucide-react";
import { getInventoryBadgeVariant } from "../lib/tone-utils";

export default function ProjectsPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "recent">("name");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function debounceSearch(value: string) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 250);
  }
  const [newProject, setNewProject] = useState({ name: "", description: "", repoUrl: "" });

  const projectsQuery = trpc.projects.useQuery({ limit: 50 }, { enabled: Boolean(session.data) });
  const requestedAction = searchParams.get("action");
  const totalProjects = projectsQuery.data?.length ?? 0;
  const hasProjects = totalProjects > 0;

  const allProjects = (projectsQuery.data ?? []).filter((p) =>
    String(p.name).toLowerCase().includes(search.toLowerCase())
  );

  const sortedProjects = [...allProjects].sort((a, b) => {
    if (sortBy === "name") return String(a.name).localeCompare(String(b.name));
    // Sort by most recent first (createdAt descending)
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });

  const createProject = trpc.createProject.useMutation({
    onSuccess: () => {
      handleDialogOpenChange(false);
      setNewProject({ name: "", description: "", repoUrl: "" });
      void projectsQuery.refetch();
    }
  });

  useEffect(() => {
    if (requestedAction === "new") {
      setDialogOpen(true);
    }
  }, [requestedAction]);

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);

    if (!open && requestedAction === "new") {
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  }

  const handleOpenProject = useCallback(
    (projectId: string) => {
      void navigate(`/projects/${projectId}`);
    },
    [navigate]
  );

  return (
    <main className="shell space-y-6" data-testid="projects-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Manage your Docker and Compose deployment projects.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
          <DialogTrigger asChild>
            <Button data-testid="projects-new-project-trigger">
              <Plus size={16} /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Project</DialogTitle>
              <DialogDescription>
                Set up a new deployment project. You can add environments after creation.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                createProject.mutate({
                  name: newProject.name,
                  description: newProject.description || undefined,
                  repoUrl: newProject.repoUrl || undefined
                });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="project-name">Project Name *</Label>
                <Input
                  id="project-name"
                  placeholder="my-web-app"
                  value={newProject.name}
                  onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))}
                  required
                  minLength={1}
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-desc">Description</Label>
                <Input
                  id="project-desc"
                  placeholder="Production web application"
                  value={newProject.description}
                  onChange={(e) => setNewProject((p) => ({ ...p, description: e.target.value }))}
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-repo">Git Repository URL</Label>
                <Input
                  id="project-repo"
                  placeholder="https://github.com/org/repo"
                  value={newProject.repoUrl}
                  onChange={(e) => setNewProject((p) => ({ ...p, repoUrl: e.target.value }))}
                  maxLength={300}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!newProject.name || createProject.isPending}>
                  {createProject.isPending ? (
                    <>
                      <Loader2 size={14} className="mr-1 animate-spin" /> Creating…
                    </>
                  ) : (
                    "Create Project"
                  )}
                </Button>
              </div>
              {createProject.error && (
                <p className="text-sm text-destructive">{createProject.error.message}</p>
              )}
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {hasProjects || searchInput ? (
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search projects..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                debounceSearch(e.target.value);
              }}
              className="pl-9 shadow-sm"
            />
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as "name" | "recent")}>
            <SelectTrigger className="w-[140px]">
              <ArrowUpDown size={14} className="mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="recent">Recent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {projectsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : !hasProjects ? (
        <EmptyState
          action={
            <Button
              data-testid="projects-empty-create-project"
              size="lg"
              onClick={() => handleDialogOpenChange(true)}
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
      ) : sortedProjects.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
            <FolderKanban size={28} className="text-primary/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {search ? "No matching projects" : "No projects yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search
                ? "Try a different search term."
                : "Create your first project to get started."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedProjects.map((p) => (
            <ProjectCard key={String(p.id)} project={p} onOpenProject={handleOpenProject} />
          ))}
        </div>
      )}
    </main>
  );
}

interface ProjectCardProject {
  id: string | number;
  name: string;
  sourceType?: string | null;
  status: string;
  repoFullName?: string | null;
  repoUrl?: string | null;
}

interface ProjectCardProps {
  project: ProjectCardProject;
  onOpenProject: (projectId: string) => void;
}

export const ProjectCard = memo(function ProjectCard({ project, onOpenProject }: ProjectCardProps) {
  return (
    <Card
      className="group cursor-pointer overflow-hidden border-border/50 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-md"
      onClick={() => onOpenProject(String(project.id))}
    >
      <CardHeader className="flex-row items-center gap-3 space-y-0 pb-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8 transition-colors group-hover:bg-primary/12">
          <FolderKanban size={18} className="text-primary/70" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{String(project.name)}</p>
          <p className="text-xs text-muted-foreground">{String(project.sourceType ?? "compose")}</p>
        </div>
        <Badge variant={getInventoryBadgeVariant(String(project.status))}>
          {String(project.status)}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="truncate text-xs text-muted-foreground">
          {project.repoFullName ?? project.repoUrl ?? "No repository linked"}
        </p>
      </CardContent>
    </Card>
  );
});

ProjectCard.displayName = "ProjectCard";
