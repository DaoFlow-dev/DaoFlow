import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layers, Pencil, Trash2 } from "lucide-react";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";
import type { EnvironmentRecord } from "./types";

interface EnvironmentCardsProps {
  environments: EnvironmentRecord[];
  serverLabelById: ReadonlyMap<string, string>;
  onEdit: (environment: EnvironmentRecord) => void;
  onDelete: (environment: EnvironmentRecord) => void;
}

export function EnvironmentCards({
  environments,
  serverLabelById,
  onEdit,
  onDelete
}: EnvironmentCardsProps) {
  if (environments.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-muted-foreground">
          No environments yet. Create production, staging, or preview lanes here before adding
          services.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {environments.map((environment) => (
        <Card key={environment.id} className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers size={15} />
                  {environment.name}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{environment.id}</p>
              </div>
              <Badge
                variant={getInventoryBadgeVariant(environment.statusTone ?? environment.status)}
              >
                {environment.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 text-muted-foreground">
              <p>
                Server:{" "}
                <span className="text-foreground">
                  {environment.targetServerId
                    ? (serverLabelById.get(environment.targetServerId) ??
                      environment.targetServerId)
                    : "Project default"}
                </span>
              </p>
              <p>
                Services: <span className="text-foreground">{environment.serviceCount ?? 0}</span>
              </p>
              <p>
                Compose files:{" "}
                <span className="text-foreground">
                  {environment.composeFiles?.length
                    ? environment.composeFiles.join(", ")
                    : "Project default"}
                </span>
              </p>
              <p>
                Compose profiles:{" "}
                <span className="text-foreground">
                  {environment.composeProfiles?.length
                    ? environment.composeProfiles.join(", ")
                    : "Project default"}
                </span>
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(environment)}
                data-testid={`project-environment-edit-${environment.id}`}
              >
                <Pencil size={14} className="mr-1" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDelete(environment)}
                data-testid={`project-environment-delete-${environment.id}`}
              >
                <Trash2 size={14} className="mr-1" />
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
