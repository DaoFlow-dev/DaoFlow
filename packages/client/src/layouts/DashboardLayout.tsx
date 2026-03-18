import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useTheme } from "../components/theme-context";
import { useSession, authClient } from "../lib/auth-client";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
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

          <TooltipProvider delayDuration={0}>
            <nav className="sidebar__nav">
              <p className="sidebar__group-label">{!collapsed && "Home"}</p>
              {homeNav.map((item) => {
                const link = (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={"end" in item ? item.end : false}
                    className={({ isActive }) =>
                      `sidebar__link${isActive ? " sidebar__link--active" : ""}`
                    }
                  >
                    <item.icon size={18} className="sidebar__link-icon" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                );
                return collapsed ? (
                  <Tooltip key={item.to}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                );
              })}

              <Separator className="my-2" />
              <p className="sidebar__group-label">{!collapsed && "Settings"}</p>
              {settingsNav.map((item) => {
                const link = (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.tab === null}
                    className={() =>
                      `sidebar__link${isSettingsItemActive(item.tab) ? " sidebar__link--active" : ""}`
                    }
                  >
                    <item.icon size={18} className="sidebar__link-icon" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                );
                return collapsed ? (
                  <Tooltip key={item.to}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </nav>
          </TooltipProvider>

          <div className="sidebar__footer">
            {(() => {
              const btn = (
                <button
                  className="sidebar__link"
                  onClick={() => {
                    const { resolved, setTheme } = themeCtx;
                    setTheme(resolved === "dark" ? "light" : "dark");
                  }}
                >
                  {themeCtx.resolved === "dark" ? (
                    <Sun size={18} className="sidebar__link-icon" />
                  ) : (
                    <Moon size={18} className="sidebar__link-icon" />
                  )}
                  {!collapsed && (
                    <span>{themeCtx.resolved === "dark" ? "Light mode" : "Dark mode"}</span>
                  )}
                </button>
              );
              return collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent side="right">Toggle theme</TooltipContent>
                </Tooltip>
              ) : (
                btn
              );
            })()}
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
                <DropdownMenuItem onClick={() => void navigate("/profile")}>
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
              {crumbs.map((crumb, i) => {
                const path =
                  "/" +
                  crumbs
                    .slice(0, i + 1)
                    .map((c) => c.toLowerCase())
                    .join("/");
                const isLast = i === crumbs.length - 1;
                return (
                  <span key={crumb}>
                    {i > 0 && <span className="topbar__breadcrumb-sep">/</span>}
                    {isLast ? (
                      <span className="topbar__breadcrumb-current">{crumb}</span>
                    ) : (
                      <button
                        className="topbar__breadcrumb-item hover:underline"
                        onClick={() => void navigate(path === "/dashboard" ? "/" : path)}
                      >
                        {crumb}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>
            <div className="flex items-center gap-1">
              <KeyboardShortcutsDialog />
            </div>
          </header>

          <div className="page-content" id="main-content">
            {isOffline && (
              <div className="mb-4 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-600 dark:text-yellow-400">
                You appear to be offline. Some features may not work until your connection is
                restored.
              </div>
            )}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
          <CommandPalette />
        </section>
      </div>
    </>
  );
}
