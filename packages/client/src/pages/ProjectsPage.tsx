/* eslint-disable @typescript-eslint/no-base-to-string */
import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FolderKanban, Plus, Search } from "lucide-react";

export default function ProjectsPage() {
  const session = useSession();
  const [search, setSearch] = useState("");
  const infra = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });

  const projects = (infra.data?.projects ?? []).filter((p) =>
    String(p.name).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="shell space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Manage your Docker and Compose deployment projects.
          </p>
        </div>
        <Button disabled>
          <Plus size={16} /> New Project
        </Button>
      </div>

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <FolderKanban size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {search ? "No projects match your search." : "No projects yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Card key={String(p.id)} className="cursor-pointer transition-colors hover:bg-muted/50">
              <CardHeader className="flex-row items-center gap-3 space-y-0 pb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <FolderKanban size={18} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold">{String(p.name)}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.environmentCount ?? 0} environment
                    {(p.environmentCount ?? 0) !== 1 ? "s" : ""}
                  </p>
                </div>
                <Badge
                  variant={
                    p.latestDeploymentStatus === "healthy"
                      ? "default"
                      : p.latestDeploymentStatus === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {String(p.latestDeploymentStatus ?? "No deploys")}
                </Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">
                  {p.serviceCount ?? 0} service
                  {(p.serviceCount ?? 0) !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
