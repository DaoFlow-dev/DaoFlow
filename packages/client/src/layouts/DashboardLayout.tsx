import { useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useTheme } from "../components/ThemeProvider";
import { useSession, authClient } from "../lib/auth-client";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
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
  HardDrive,
  ChevronsUpDown,
  Hexagon,
  Bot,
  Radio,
  Sun,
  Moon
} from "lucide-react";

const homeNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/deployments", label: "Deployments", icon: Rocket },
  { to: "/backups", label: "Backups", icon: DatabaseBackup },
  { to: "/destinations", label: "Destinations", icon: HardDrive },
  { to: "/notifications", label: "Notifications", icon: Radio },
  { to: "/agents", label: "Agents", icon: Bot }
] as const;

const settingsNav = [
  { to: "/settings", label: "General", icon: Settings, tab: null },
  { to: "/settings?tab=users", label: "Users", icon: User, tab: "users" },
  { to: "/settings?tab=tokens", label: "Tokens", icon: KeyRound, tab: "tokens" },
  { to: "/settings?tab=security", label: "Security", icon: Shield, tab: "security" },
  { to: "/settings?tab=notifications", label: "Notifications", icon: Bell, tab: "notifications" }
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
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const themeCtx = useTheme();
  const crumbs = breadcrumbFromPath(location.pathname);

  // Loading state
  if (session.isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!session.data) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  const userInitial = session.data.user.name?.charAt(0).toUpperCase() ?? "U";

  function isSettingsItemActive(tab: string | null) {
    if (location.pathname !== "/settings") {
      return false;
    }

    const params = new URLSearchParams(location.search);
    const currentTab = params.get("tab");
    if (tab === null) {
      return currentTab === null || currentTab === "general";
    }

    return currentTab === tab;
  }

  return (
    <div className={`layout${collapsed ? " layout--collapsed" : ""}`}>
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Hexagon size={24} strokeWidth={1.5} />
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

          <Separator className="my-2" />
          <p className="sidebar__group-label">{!collapsed && "Settings"}</p>
          {settingsNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.tab === null}
              className={() =>
                `sidebar__link${isSettingsItemActive(item.tab) ? " sidebar__link--active" : ""}`
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} className="sidebar__link-icon" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          <button
            className="sidebar__link"
            onClick={() => {
              const { resolved, setTheme } = themeCtx;
              setTheme(resolved === "dark" ? "light" : "dark");
            }}
            title={collapsed ? "Toggle theme" : undefined}
          >
            {themeCtx.resolved === "dark" ? (
              <Sun size={18} className="sidebar__link-icon" />
            ) : (
              <Moon size={18} className="sidebar__link-icon" />
            )}
            {!collapsed && <span>{themeCtx.resolved === "dark" ? "Light mode" : "Dark mode"}</span>}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="sidebar__user-card">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">{userInitial}</AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <div className="sidebar__user-info">
                      <p className="sidebar__user-name">{session.data.user.name}</p>
                      <p className="sidebar__user-email">{session.data.user.email}</p>
                    </div>
                    <ChevronsUpDown size={14} className="ml-auto opacity-50" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="w-56" align="start">
              <DropdownMenuLabel>
                <p className="font-medium">{session.data.user.name}</p>
                <p className="text-xs text-muted-foreground">{session.data.user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void navigate("/profile")}
              >
                <User size={14} />
                Profile Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void authClient.signOut()}
                className="text-destructive"
              >
                <LogOut size={14} />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
