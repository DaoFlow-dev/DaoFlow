import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";

export default function ProjectsPage() {
  const session = useSession();
  const infra = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });

  const projects = infra.data?.projects ?? [];

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero__topbar">
          <div className="hero__brand">
            <p className="hero__kicker">Project management</p>
            <h1>Projects</h1>
          </div>
          <p className="hero__lede">Manage your Docker and Compose deployment projects.</p>
        </div>
      </section>

      <section style={{ marginTop: "1rem" }}>
        {!session.data ? (
          <p style={{ color: "#7a8194" }}>Sign in to view projects.</p>
        ) : infra.isLoading ? (
          <div className="skeleton" style={{ height: "6rem" }} />
        ) : projects.length === 0 ? (
          <div className="auth-panel" style={{ textAlign: "center", padding: "2rem" }}>
            <p style={{ color: "#7a8194", margin: 0 }}>
              No projects yet. Create your first project to get started.
            </p>
          </div>
        ) : (
          <div className="deployment-list">
            {projects.map((p) => (
              <article className="deployment-card" key={p.id}>
                <div className="deployment-card__top">
                  <h3>{p.name}</h3>
                  <span
                    className={`deployment-status deployment-status--${p.latestDeploymentStatus === "completed" ? "healthy" : "queued"}`}
                  >
                    {p.latestDeploymentStatus || "new"}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {p.environmentCount} environment{p.environmentCount !== 1 ? "s" : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
