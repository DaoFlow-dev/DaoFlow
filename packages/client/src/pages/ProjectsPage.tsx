/* eslint-disable @typescript-eslint/no-base-to-string */
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { FolderKanban, Plus, Search } from "lucide-react";
import { useState } from "react";

export default function ProjectsPage() {
  const session = useSession();
  const infra = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const [search, setSearch] = useState("");

  const projects = (infra.data?.projects ?? []).filter((p) =>
    String(p.name).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="shell">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Projects</h1>
          <p className="page-header__desc">Manage your Docker and Compose deployment projects.</p>
        </div>
        <button className="action-button" disabled>
          <Plus size={16} /> New Project
        </button>
      </div>

      {!session.data ? (
        <div className="empty-state">
          <p>Sign in to view projects.</p>
        </div>
      ) : infra.isLoading ? (
        <div className="skeleton" style={{ height: "12rem" }} />
      ) : (
        <>
          {/* Search bar */}
          <div className="search-bar">
            <Search size={16} className="search-bar__icon" />
            <input
              className="search-bar__input"
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {projects.length === 0 ? (
            <div className="empty-state">
              <FolderKanban size={32} />
              <p>No projects yet. Create your first project to get started.</p>
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((p) => (
                <article className="project-card" key={String(p.id)}>
                  <div className="project-card__top">
                    <div className="project-card__icon">
                      <FolderKanban size={18} />
                    </div>
                    <div className="project-card__info">
                      <h3 className="project-card__name">{String(p.name)}</h3>
                      <p className="project-card__meta">
                        {p.environmentCount} environment
                        {p.environmentCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <span
                      className={`badge badge--${p.latestDeploymentStatus === "healthy" ? "green" : p.latestDeploymentStatus === "failed" ? "red" : p.latestDeploymentStatus === "running" ? "blue" : "amber"}`}
                    >
                      {p.latestDeploymentStatus || "new"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
