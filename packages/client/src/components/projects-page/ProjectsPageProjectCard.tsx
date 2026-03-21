import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FolderKanban } from "lucide-react";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";
import type { ProjectsPageProject } from "@/pages/projects-page/projects-page-types";

interface ProjectsPageProjectCardProps {
  project: ProjectsPageProject;
  onOpenProject: (projectId: string) => void;
}

export const ProjectsPageProjectCard = memo(function ProjectsPageProjectCard({
  project,
  onOpenProject
}: ProjectsPageProjectCardProps) {
  return (
    <Card
      className="group cursor-pointer overflow-hidden border-border/50 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-md"
      data-testid={`project-card-${String(project.id)}`}
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
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{project.environmentCount ?? 0} env</span>
          <span>{project.serviceCount ?? 0} svc</span>
          <span>{project.defaultBranch ?? "main"}</span>
        </div>
      </CardContent>
    </Card>
  );
});

ProjectsPageProjectCard.displayName = "ProjectCard";
