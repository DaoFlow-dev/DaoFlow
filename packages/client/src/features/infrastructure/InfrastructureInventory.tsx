import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getInventoryTone, getBadgeVariantFromTone } from "@/lib/tone-utils";

interface ServerItem {
  id: string;
  name: string;
  kind: string;
  host: string;
  region: string;
  sshPort: number;
  status: string;
  statusTone?: string;
  engineVersion: string;
  environmentCount: number;
  lastHeartbeatAt: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
  defaultBranch: string;
  repositoryUrl: string;
  serviceCount: number;
  environmentCount: number;
  latestDeploymentStatus: string;
  statusTone?: string;
}

interface EnvironmentItem {
  id: string;
  name: string;
  projectName: string;
  status: string;
  targetServerName: string;
  networkName: string;
  composeFilePath: string;
  serviceCount: number;
  statusTone?: string;
}

interface InventoryData {
  summary: {
    totalServers: number;
    totalProjects: number;
    totalEnvironments: number;
    healthyServers: number;
  };
  servers: ServerItem[];
  projects: ProjectItem[];
  environments: EnvironmentItem[];
}

export interface InfrastructureInventoryProps {
  session: { data: unknown };
  infrastructureInventory: { data?: InventoryData };
  infrastructureMessage: string | null;
}

export function InfrastructureInventory({
  session,
  infrastructureInventory,
  infrastructureMessage
}: InfrastructureInventoryProps) {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Inventory slice
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Servers, projects, and environments
        </h2>
      </div>

      {session.data && infrastructureInventory.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="inventory-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Servers
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {infrastructureInventory.data.summary.totalServers}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Projects
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {infrastructureInventory.data.summary.totalProjects}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Environments
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {infrastructureInventory.data.summary.totalEnvironments}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Healthy servers
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {infrastructureInventory.data.summary.healthyServers}
              </strong>
            </Card>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-3 content-start">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Managed targets
                </p>
                <h3 className="text-base font-semibold text-foreground">Servers</h3>
              </div>
              <div className="grid gap-3">
                {infrastructureInventory.data.servers.map((server) => {
                  const statusTone = server.statusTone ?? getInventoryTone(server.status);

                  return (
                    <article
                      className="rounded-xl border bg-card p-5 shadow-sm"
                      data-testid={`server-card-${server.id}`}
                      key={server.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {server.kind}
                          </p>
                          <h3 className="text-base font-semibold text-foreground">{server.name}</h3>
                        </div>
                        <Badge variant={getBadgeVariantFromTone(statusTone)}>{server.status}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {server.host} · {server.region} · SSH {server.sshPort}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {server.engineVersion} · {server.environmentCount} attached environments
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Last heartbeat: {server.lastHeartbeatAt ?? "No heartbeat recorded"}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 content-start">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Deployment surfaces
                </p>
                <h3 className="text-base font-semibold text-foreground">Projects</h3>
              </div>
              <div className="grid gap-3">
                {infrastructureInventory.data.projects.map((project) => {
                  const statusTone =
                    project.statusTone ?? getInventoryTone(project.latestDeploymentStatus);

                  return (
                    <article
                      className="rounded-xl border bg-card p-5 shadow-sm"
                      data-testid={`project-card-${project.id}`}
                      key={project.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {project.defaultBranch}
                          </p>
                          <h3 className="text-base font-semibold text-foreground">
                            {project.name}
                          </h3>
                        </div>
                        <Badge variant={getBadgeVariantFromTone(statusTone)}>
                          {project.latestDeploymentStatus}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{project.repositoryUrl}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {project.serviceCount} services · {project.environmentCount} environments
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 content-start">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Compose topology
                </p>
                <h3 className="text-base font-semibold text-foreground">Environments</h3>
              </div>
              <div className="grid gap-3">
                {infrastructureInventory.data.environments.map((environment) => {
                  const statusTone = environment.statusTone ?? getInventoryTone(environment.status);

                  return (
                    <article
                      className="rounded-xl border bg-card p-5 shadow-sm"
                      data-testid={`environment-card-${environment.id}`}
                      key={environment.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {environment.projectName}
                          </p>
                          <h3 className="text-base font-semibold text-foreground">
                            {environment.name}
                          </h3>
                        </div>
                        <Badge variant={getBadgeVariantFromTone(statusTone)}>
                          {environment.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {environment.targetServerName} · Network {environment.networkName}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {environment.composeFilePath}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {environment.serviceCount} Compose services
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {infrastructureMessage ??
            "Sign in to inspect managed servers, projects, and environments."}
        </p>
      )}
    </section>
  );
}
