import {
  Archive,
  Bell,
  Clock,
  DatabaseBackup,
  FolderKanban,
  LayoutDashboard,
  LayoutTemplate,
  Plus,
  Rocket,
  Server,
  Settings,
  User
} from "lucide-react";
import type { PaletteItem } from "./types";

export const NAVIGATION_ITEMS: PaletteItem[] = [
  {
    id: "dash",
    label: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
    section: "Navigation"
  },
  {
    id: "proj",
    label: "Projects",
    path: "/projects",
    icon: FolderKanban,
    section: "Navigation"
  },
  {
    id: "tmpl",
    label: "Templates",
    path: "/templates",
    icon: LayoutTemplate,
    section: "Navigation"
  },
  {
    id: "serv",
    label: "Servers",
    path: "/servers",
    icon: Server,
    section: "Navigation"
  },
  {
    id: "back",
    label: "Backups",
    path: "/backups",
    icon: DatabaseBackup,
    section: "Navigation"
  },
  {
    id: "notif",
    label: "Notifications",
    path: "/notifications",
    icon: Bell,
    section: "Navigation"
  },
  {
    id: "sett",
    label: "Settings",
    path: "/settings",
    icon: Settings,
    section: "Navigation"
  },
  {
    id: "prof",
    label: "Profile",
    path: "/profile",
    icon: User,
    section: "Navigation"
  }
];

const QUICK_ACTION_ITEMS: PaletteItem[] = [
  {
    id: "qa-create-project",
    label: "Create Project",
    path: "/projects?action=new",
    icon: Plus,
    section: "Quick Actions"
  },
  {
    id: "qa-browse-templates",
    label: "Browse Templates",
    path: "/templates",
    icon: LayoutTemplate,
    section: "Quick Actions"
  },
  {
    id: "qa-trigger-deploy",
    label: "Trigger Deployment",
    path: "/deployments",
    icon: Rocket,
    section: "Quick Actions"
  },
  {
    id: "qa-view-backups",
    label: "View Backups",
    path: "/backups",
    icon: Archive,
    section: "Quick Actions"
  }
];

export const ALL_ITEMS: PaletteItem[] = [...QUICK_ACTION_ITEMS, ...NAVIGATION_ITEMS];

export const COMMAND_PALETTE_INPUT_ID = "command-palette-input";
export const COMMAND_PALETTE_LISTBOX_ID = "command-palette-listbox";

const LABEL_MAP: Record<string, string> = {
  "/": "Dashboard",
  "/projects": "Projects",
  "/templates": "Templates",
  "/servers": "Servers",
  "/backups": "Backups",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/profile": "Profile",
  "/deployments": "Deployments"
};

const ICON_MAP: Record<string, PaletteItem["icon"]> = {
  "/": LayoutDashboard,
  "/projects": FolderKanban,
  "/templates": LayoutTemplate,
  "/servers": Server,
  "/backups": DatabaseBackup,
  "/notifications": Bell,
  "/settings": Settings,
  "/profile": User,
  "/deployments": Rocket
};

export function buildRecentItems(recentPages: string[]): PaletteItem[] {
  return recentPages
    .filter((path) => LABEL_MAP[path])
    .map((path) => ({
      id: `recent-${path}`,
      label: LABEL_MAP[path] ?? path,
      path,
      icon: ICON_MAP[path] ?? Clock,
      section: "Recent"
    }));
}

export function getPaletteOptionId(item: Pick<PaletteItem, "id">) {
  return `command-palette-option-${item.id}`;
}
