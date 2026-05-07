import {
  LayoutDashboard,
  FolderKanban,
  Server,
  Rocket,
  DatabaseBackup,
  CalendarClock,
  Settings,
  User,
  Shield,
  KeyRound,
  Bell,
  HardDrive,
  Bot,
  Workflow,
  Radio,
  ShieldCheck,
  ScrollText,
  Upload,
  Wrench,
  Boxes,
  GitBranch,
  Lock
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  end?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

export interface SettingsNavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tab: string | null;
}

export const homeNavGroups: NavGroup[] = [
  {
    key: "core",
    label: "Core",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/projects", label: "Projects", icon: FolderKanban },
      { to: "/deploy", label: "Deploy", icon: Upload },
      { to: "/servers", label: "Servers", icon: Server }
    ]
  },
  {
    key: "operations",
    label: "Operations",
    items: [
      { to: "/deployments", label: "Deployments", icon: Rocket },
      { to: "/backups", label: "Backups", icon: DatabaseBackup },
      { to: "/schedules", label: "Schedules", icon: CalendarClock },
      { to: "/destinations", label: "Destinations", icon: HardDrive }
    ]
  },
  {
    key: "automation",
    label: "Automation",
    items: [
      { to: "/agents", label: "Agents", icon: Bot },
      { to: "/development-tasks", label: "Dev Tasks", icon: Workflow },
      { to: "/approvals", label: "Approvals", icon: ShieldCheck }
    ]
  },
  {
    key: "monitoring",
    label: "Monitoring",
    items: [
      { to: "/notifications", label: "Notifications", icon: Radio },
      { to: "/requests", label: "Requests", icon: ScrollText }
    ]
  }
];

export const settingsNav: SettingsNavItem[] = [
  { to: "/settings", label: "General", icon: Settings, tab: null },
  { to: "/settings?tab=users", label: "Users", icon: User, tab: "users" },
  { to: "/settings?tab=tokens", label: "Tokens", icon: KeyRound, tab: "tokens" },
  { to: "/settings?tab=security", label: "Security", icon: Shield, tab: "security" },
  { to: "/settings?tab=notifications", label: "Notifications", icon: Bell, tab: "notifications" },
  { to: "/settings?tab=volumes", label: "Volumes", icon: HardDrive, tab: "volumes" },
  { to: "/settings?tab=operations", label: "Operations", icon: Wrench, tab: "operations" },
  { to: "/settings?tab=registries", label: "Registries", icon: Boxes, tab: "registries" },
  { to: "/settings?tab=git", label: "Git", icon: GitBranch, tab: "git" },
  { to: "/settings?tab=secrets", label: "Secrets", icon: Lock, tab: "secrets" }
];
