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
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  User,
  ChevronsUpDown,
  Hexagon,
  Sun,
  Moon,
  Menu
} from "lucide-react";
import { homeNavGroups, settingsNav } from "./sidebar-nav";

const ID_SEGMENT_RE = /^[0-9a-f]{9,}$|^[0-9a-f-]{20,}$/i;

function formatSegment(s: string): string {
  if (ID_SEGMENT_RE.test(s)) return s.slice(0, 8) + "…";
  return s
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function breadcrumbFromPath(pathname: string): string[] {
  if (pathname === "/") return ["Dashboard"];
  return pathname.split("/").filter(Boolean).map(formatSegment);
}

export function DashboardLayout() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const themeCtx = useTheme();
  const crumbs = breadcrumbFromPath(location.pathname);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem("df-sidebar-groups");
      if (stored) return JSON.parse(stored) as Record<string, boolean>;
    } catch {
      /* ignore */
    }
    return Object.fromEntries(homeNavGroups.map((g) => [g.key, true]));
  });

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("df-sidebar-groups", JSON.stringify(next));
      return next;
    });
  };

  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

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

  useEffect(() => {
    if (!mobileOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mobileOpen]);

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
      <div className="layout" data-collapsed={collapsed ? "true" : "false"}>
        <div
          className="mobile-backdrop"
          data-open={mobileOpen ? "true" : "false"}
          onClick={() => setMobileOpen(false)}
        />
        {/* ── Sidebar ── */}
        <aside className="sidebar" data-mobile-open={mobileOpen ? "true" : "false"}>
          <div className="sidebar__brand">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Hexagon size={18} strokeWidth={1.5} className="text-primary" />
            </div>
            {!collapsed && <span className="sidebar__title">DaoFlow</span>}
          </div>

          <button
            className="sidebar__toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          <TooltipProvider delay={0}>
            <nav className="sidebar__nav">
              {homeNavGroups.map((group) => {
                const isOpen = openGroups[group.key] !== false;
                return (
                  <div key={group.key}>
                    {collapsed ? (
                      <p className="sidebar__group-label" />
                    ) : (
                      <button
                        className="sidebar__group-toggle"
                        data-open={isOpen ? "true" : "false"}
                        onClick={() => toggleGroup(group.key)}
                      >
                        {group.label}
                        <ChevronDown size={12} />
                      </button>
                    )}
                    <div
                      className="sidebar__group-items"
                      data-open={collapsed || isOpen ? "true" : "false"}
                    >
                      <div className="sidebar__group-items-inner">
                        {group.items.map((item) => {
                          const link = (
                            <NavLink
                              key={item.to}
                              to={item.to}
                              end={item.end ?? false}
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
                              <TooltipTrigger render={link} />
                              <TooltipContent side="right">{item.label}</TooltipContent>
                            </Tooltip>
                          ) : (
                            link
                          );
                        })}
                      </div>
                    </div>
                  </div>
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
                    <TooltipTrigger render={link} />
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </nav>
          </TooltipProvider>

          <TooltipProvider delay={0}>
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
                    <TooltipTrigger render={btn} />
                    <TooltipContent side="right">Toggle theme</TooltipContent>
                  </Tooltip>
                ) : (
                  btn
                );
              })()}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button className="sidebar__user-card group">
                      <Avatar className="h-8 w-8 ring-2 ring-transparent transition-all group-hover:ring-primary/20">
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {userInitial}
                        </AvatarFallback>
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
                  }
                />
                <DropdownMenuContent side="top" className="w-56 backdrop-blur-xl" align="start">
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
          </TooltipProvider>
        </aside>

        {/* ── Main content ── */}
        <section className="layout__content">
          <header className="topbar" role="banner">
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              <Menu size={20} />
            </button>
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
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-600 backdrop-blur-sm dark:text-yellow-400">
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
