import { getInventoryTone } from "@/lib/tone-utils";

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
    <section className="infrastructure-inventory">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Inventory slice</p>
        <h2>Servers, projects, and environments</h2>
      </div>

      {session.data && infrastructureInventory.data ? (
        <>
          <div className="inventory-summary" data-testid="inventory-summary">
            <div className="token-summary__item">
              <span className="metric__label">Servers</span>
              <strong>{infrastructureInventory.data.summary.totalServers}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Projects</span>
              <strong>{infrastructureInventory.data.summary.totalProjects}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Environments</span>
              <strong>{infrastructureInventory.data.summary.totalEnvironments}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Healthy servers</span>
              <strong>{infrastructureInventory.data.summary.healthyServers}</strong>
            </div>
          </div>

          <div className="inventory-columns">
            <div className="inventory-column">
              <div className="inventory-column__header">
                <p className="roadmap-item__lane">Managed targets</p>
                <h3>Servers</h3>
              </div>
              <div className="inventory-list">
                {infrastructureInventory.data.servers.map((server) => {
                  const statusTone = server.statusTone ?? getInventoryTone(server.status);

                  return (
                    <article
                      className="token-card"
                      data-testid={`server-card-${server.id}`}
                      key={server.id}
                    >
                      <div className="token-card__top">
                        <div>
                          <p className="roadmap-item__lane">{server.kind}</p>
                          <h3>{server.name}</h3>
                        </div>
                        <span className={`deployment-status deployment-status--${statusTone}`}>
                          {server.status}
                        </span>
                      </div>
                      <p className="deployment-card__meta">
                        {server.host} · {server.region} · SSH {server.sshPort}
                      </p>
                      <p className="deployment-card__meta">
                        {server.engineVersion} · {server.environmentCount} attached environments
                      </p>
                      <p className="deployment-card__meta">
                        Last heartbeat: {server.lastHeartbeatAt ?? "No heartbeat recorded"}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="inventory-column">
              <div className="inventory-column__header">
                <p className="roadmap-item__lane">Deployment surfaces</p>
                <h3>Projects</h3>
              </div>
              <div className="inventory-list">
                {infrastructureInventory.data.projects.map((project) => {
                  const statusTone =
                    project.statusTone ?? getInventoryTone(project.latestDeploymentStatus);

                  return (
                    <article
                      className="token-card"
                      data-testid={`project-card-${project.id}`}
                      key={project.id}
                    >
                      <div className="token-card__top">
                        <div>
                          <p className="roadmap-item__lane">{project.defaultBranch}</p>
                          <h3>{project.name}</h3>
                        </div>
                        <span className={`deployment-status deployment-status--${statusTone}`}>
                          {project.latestDeploymentStatus}
                        </span>
                      </div>
                      <p className="deployment-card__meta">{project.repositoryUrl}</p>
                      <p className="deployment-card__meta">
                        {project.serviceCount} services · {project.environmentCount} environments
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="inventory-column">
              <div className="inventory-column__header">
                <p className="roadmap-item__lane">Compose topology</p>
                <h3>Environments</h3>
              </div>
              <div className="inventory-list">
                {infrastructureInventory.data.environments.map((environment) => {
                  const statusTone = environment.statusTone ?? getInventoryTone(environment.status);

                  return (
                    <article
                      className="timeline-event"
                      data-testid={`environment-card-${environment.id}`}
                      key={environment.id}
                    >
                      <div className="timeline-event__top">
                        <div>
                          <p className="roadmap-item__lane">{environment.projectName}</p>
                          <h3>{environment.name}</h3>
                        </div>
                        <span className={`deployment-status deployment-status--${statusTone}`}>
                          {environment.status}
                        </span>
                      </div>
                      <p className="deployment-card__meta">
                        {environment.targetServerName} · Network {environment.networkName}
                      </p>
                      <p className="deployment-card__meta">{environment.composeFilePath}</p>
                      <p className="deployment-card__meta">
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
        <p className="viewer-empty">
          {infrastructureMessage ??
            "Sign in to inspect managed servers, projects, and environments."}
        </p>
      )}
    </section>
  );
}
