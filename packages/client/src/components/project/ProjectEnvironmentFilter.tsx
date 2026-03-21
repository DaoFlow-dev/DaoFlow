import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectDetailEnvironment } from "@/pages/project-detail/project-detail-types";

interface ProjectEnvironmentFilterProps {
  activeEnvironmentId: string | null;
  environments: ProjectDetailEnvironment[];
  onEnvironmentChange: (environmentId: string | null) => void;
}

export function ProjectEnvironmentFilter({
  activeEnvironmentId,
  environments,
  onEnvironmentChange
}: ProjectEnvironmentFilterProps) {
  if (environments.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2" data-testid="project-environment-filter">
      <span className="text-sm text-muted-foreground">Environment:</span>
      <Tabs
        value={activeEnvironmentId ?? "all"}
        onValueChange={(value) => onEnvironmentChange(value === "all" ? null : value)}
      >
        <TabsList className="h-8">
          <TabsTrigger value="all" className="h-6 px-3 text-xs">
            All
          </TabsTrigger>
          {environments.map((environment) => (
            <TabsTrigger key={environment.id} value={environment.id} className="h-6 px-3 text-xs">
              {environment.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
