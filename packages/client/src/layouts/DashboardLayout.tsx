import { NavLink, Outlet } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { PageTitle } from "../components/PageTitle";
import { useSession } from "../lib/auth-client";

const navItems = [
  { to: "/", label: "Dashboard", icon: "⬡" },
  { to: "/projects", label: "Projects", icon: "◫" },
  { to: "/servers", label: "Servers", icon: "⬢" },
  { to: "/deployments", label: "Deployments", icon: "▸" },
  { to: "/backups", label: "Backups", icon: "⛁" },
  { to: "/settings", label: "Settings", icon: "⚙" }
] as const;

export function DashboardLayout() {
  const session = useSession();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">⬡</span>
          <span className="sidebar__title">DaoFlow</span>
        </div>

        <nav className="sidebar__nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `sidebar__link${isActive ? " sidebar__link--active" : ""}`
              }
            >
              <span className="sidebar__link-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          {session.data ? (
            <p className="sidebar__user">{session.data.user.email}</p>
          ) : (
            <p className="sidebar__user">Not signed in</p>
          )}
        </div>
      </aside>

      <section className="layout__content">
        <ErrorBoundary>
          <PageTitle />
          <Outlet />
        </ErrorBoundary>
      </section>
    </div>
  );
}
