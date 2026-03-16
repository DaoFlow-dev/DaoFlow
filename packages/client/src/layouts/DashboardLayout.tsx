import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useSession } from "../lib/auth-client";
import {
  LayoutDashboard,
  FolderKanban,
  Server,
  Rocket,
  DatabaseBackup,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User,
  Shield,
  KeyRound,
  Bell,
  HardDrive
} from "lucide-react";
import { authClient } from "../lib/auth-client";

const homeNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/deployments", label: "Deployments", icon: Rocket },
  { to: "/backups", label: "Backups", icon: DatabaseBackup }
] as const;

const settingsNav = [
  { to: "/settings", label: "General", icon: Settings },
  { to: "/settings/profile", label: "Profile", icon: User },
  { to: "/settings/users", label: "Users", icon: Shield },
  { to: "/settings/ssh-keys", label: "SSH Keys", icon: KeyRound },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/volumes", label: "Volumes", icon: HardDrive }
] as const;

function breadcrumbFromPath(pathname: string): string[] {
  if (pathname === "/") return ["Dashboard"];
  return pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

export function DashboardLayout() {
  const session = useSession();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const crumbs = breadcrumbFromPath(location.pathname);

  return (
    <div className={`layout${collapsed ? " layout--collapsed" : ""}`}>
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">⬡</span>
          {!collapsed && <span className="sidebar__title">DaoFlow</span>}
        </div>

        <button
          className="sidebar__toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        <nav className="sidebar__nav">
          <p className="sidebar__group-label">{!collapsed && "Home"}</p>
          {homeNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              className={({ isActive }) =>
                `sidebar__link${isActive ? " sidebar__link--active" : ""}`
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} className="sidebar__link-icon" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}

          <p className="sidebar__group-label">{!collapsed && "Settings"}</p>
          {settingsNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `sidebar__link${isActive ? " sidebar__link--active" : ""}`
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} className="sidebar__link-icon" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          {session.data ? (
            <div className="sidebar__user-card">
              <div className="sidebar__user-avatar">
                {session.data.user.name?.charAt(0).toUpperCase() ?? "U"}
              </div>
              {!collapsed && (
                <div className="sidebar__user-info">
                  <p className="sidebar__user-name">{session.data.user.name}</p>
                  <p className="sidebar__user-email">{session.data.user.email}</p>
                </div>
              )}
              {!collapsed && (
                <button
                  className="sidebar__logout"
                  onClick={() => void authClient.signOut()}
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              )}
            </div>
          ) : (
            !collapsed && <p className="sidebar__user-email">Not signed in</p>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <section className="layout__content">
        <header className="topbar">
          <nav className="topbar__breadcrumb" aria-label="Breadcrumb">
            {crumbs.map((crumb, i) => (
              <span key={crumb}>
                {i > 0 && <span className="topbar__breadcrumb-sep">/</span>}
                <span
                  className={
                    i === crumbs.length - 1
                      ? "topbar__breadcrumb-current"
                      : "topbar__breadcrumb-item"
                  }
                >
                  {crumb}
                </span>
              </span>
            ))}
          </nav>
        </header>

        <div className="page-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </section>
    </div>
  );
}
