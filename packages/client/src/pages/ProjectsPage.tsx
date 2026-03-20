import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
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
import { FolderKanban, Plus, Search, Loader2 } from "lucide-react";
import { getInventoryBadgeVariant } from "../lib/tone-utils";

export default function ProjectsPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function debounceSearch(value: string) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 250);
  }
  const [newProject, setNewProject] = useState({ name: "", description: "", repoUrl: "" });

  const projectsQuery = trpc.projects.useQuery({ limit: 50 }, { enabled: Boolean(session.data) });

  const allProjects = (projectsQuery.data ?? []).filter((p) =>
    String(p.name).toLowerCase().includes(search.toLowerCase())
  );

  const createProject = trpc.createProject.useMutation({
    onSuccess: () => {
      setDialogOpen(false);
      setNewProject({ name: "", description: "", repoUrl: "" });
      void projectsQuery.refetch();
    }
  });

  return (
    <main className="shell space-y-6" data-testid="projects-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground/80">
            Manage your Docker and Compose deployment projects.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
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
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
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

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
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

      {projectsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : allProjects.length === 0 ? (
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
          {allProjects.map((p) => (
            <Card
              key={String(p.id)}
              className="group cursor-pointer overflow-hidden border-border/50 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-md"
              onClick={() => void navigate(`/projects/${String(p.id)}`)}
            >
              <CardHeader className="flex-row items-center gap-3 space-y-0 pb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8 transition-colors group-hover:bg-primary/12">
                  <FolderKanban size={18} className="text-primary/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold">{String(p.name)}</p>
                  <p className="text-xs text-muted-foreground">
                    {String(p.sourceType ?? "compose")}
                  </p>
                </div>
                <Badge variant={getInventoryBadgeVariant(String(p.status))}>
                  {String(p.status)}
                </Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground/70 truncate">
                  {p.repoFullName ?? p.repoUrl ?? "No repository linked"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
