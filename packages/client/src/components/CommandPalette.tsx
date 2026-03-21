import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  LayoutDashboard,
  FolderKanban,
  LayoutTemplate,
  Server,
  DatabaseBackup,
  Bell,
  Settings,
  User,
  Search,
  Plus,
  Rocket,
  Clock,
  Archive
} from "lucide-react";

interface PaletteItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  section: string;
}

const NAVIGATION_ITEMS: PaletteItem[] = [
  {
    id: "dash",
    label: "Dashboard",
    path: "/",
    icon: <LayoutDashboard size={14} />,
    section: "Navigation"
  },
  {
    id: "proj",
    label: "Projects",
    path: "/projects",
    icon: <FolderKanban size={14} />,
    section: "Navigation"
  },
  {
    id: "tmpl",
    label: "Templates",
    path: "/templates",
    icon: <LayoutTemplate size={14} />,
    section: "Navigation"
  },
  {
    id: "serv",
    label: "Servers",
    path: "/servers",
    icon: <Server size={14} />,
    section: "Navigation"
  },
  {
    id: "back",
    label: "Backups",
    path: "/backups",
    icon: <DatabaseBackup size={14} />,
    section: "Navigation"
  },
  {
    id: "notif",
    label: "Notifications",
    path: "/notifications",
    icon: <Bell size={14} />,
    section: "Navigation"
  },
  {
    id: "sett",
    label: "Settings",
    path: "/settings",
    icon: <Settings size={14} />,
    section: "Navigation"
  },
  {
    id: "prof",
    label: "Profile",
    path: "/profile",
    icon: <User size={14} />,
    section: "Navigation"
  }
];

const QUICK_ACTION_ITEMS: PaletteItem[] = [
  {
    id: "qa-create-project",
    label: "Create Project",
    path: "/projects?action=new",
    icon: <Plus size={14} />,
    section: "Quick Actions"
  },
  {
    id: "qa-browse-templates",
    label: "Browse Templates",
    path: "/templates",
    icon: <LayoutTemplate size={14} />,
    section: "Quick Actions"
  },
  {
    id: "qa-trigger-deploy",
    label: "Trigger Deployment",
    path: "/deployments",
    icon: <Rocket size={14} />,
    section: "Quick Actions"
  },
  {
    id: "qa-view-backups",
    label: "View Backups",
    path: "/backups",
    icon: <Archive size={14} />,
    section: "Quick Actions"
  }
];

const ALL_ITEMS: PaletteItem[] = [...QUICK_ACTION_ITEMS, ...NAVIGATION_ITEMS];

const RECENT_STORAGE_KEY = "daoflow-recent-pages";
const MAX_RECENT = 5;
const COMMAND_PALETTE_INPUT_ID = "command-palette-input";
const COMMAND_PALETTE_LISTBOX_ID = "command-palette-listbox";

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

const ICON_MAP: Record<string, React.ReactNode> = {
  "/": <LayoutDashboard size={14} />,
  "/projects": <FolderKanban size={14} />,
  "/templates": <LayoutTemplate size={14} />,
  "/servers": <Server size={14} />,
  "/backups": <DatabaseBackup size={14} />,
  "/notifications": <Bell size={14} />,
  "/settings": <Settings size={14} />,
  "/profile": <User size={14} />,
  "/deployments": <Rocket size={14} />
};

function loadRecentPages(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
    return [];
  } catch {
    return [];
  }
}

function saveRecentPage(path: string) {
  const recent = loadRecentPages().filter((p) => p !== path);
  recent.unshift(path);
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function getPaletteOptionId(item: PaletteItem) {
  return `command-palette-option-${item.id}`;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentPages, setRecentPages] = useState<string[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const listRef = useRef<HTMLDivElement>(null);

  // Track page visits for the "Recent" section
  useEffect(() => {
    saveRecentPage(location.pathname);
  }, [location.pathname]);

  // Reload recent pages whenever the palette opens
  useEffect(() => {
    if (open) {
      setRecentPages(loadRecentPages());
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // Build the recent items from stored paths
  const recentItems: PaletteItem[] = useMemo(
    () =>
      recentPages
        .filter((p) => LABEL_MAP[p])
        .map((p) => ({
          id: `recent-${p}`,
          label: LABEL_MAP[p] ?? p,
          path: p,
          icon: ICON_MAP[p] ?? <Clock size={14} />,
          section: "Recent"
        })),
    [recentPages]
  );

  // Filter all items (recent + quick actions + navigation)
  const filtered = useMemo(() => {
    const lq = query.toLowerCase();
    const matchFilter = (item: PaletteItem) =>
      item.label.toLowerCase().includes(lq) || item.path.toLowerCase().includes(lq);

    if (!query) {
      // When no query, show all sections
      return [...recentItems, ...ALL_ITEMS];
    }
    // When searching, include matching items from all sections
    return [...recentItems, ...ALL_ITEMS].filter(matchFilter);
  }, [query, recentItems]);

  // Group items by section, preserving insertion order
  const groupedItems = useMemo(() => {
    const groups: { section: string; items: PaletteItem[] }[] = [];
    const seen = new Map<string, PaletteItem[]>();
    for (const item of filtered) {
      const existing = seen.get(item.section);
      if (existing) {
        existing.push(item);
      } else {
        const arr = [item];
        seen.set(item.section, arr);
        groups.push({ section: item.section, items: arr });
      }
    }
    return groups;
  }, [filtered]);

  // Flat list of items for keyboard navigation
  const flatItems = useMemo(() => groupedItems.flatMap((g) => g.items), [groupedItems]);

  const handleSelect = useCallback(
    (path: string) => {
      setOpen(false);
      setQuery("");
      saveRecentPage(path);
      void navigate(path);
    },
    [navigate]
  );

  // Keyboard navigation within the list
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (flatItems.length === 0) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % flatItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
      } else if (e.key === "Enter" && flatItems[activeIndex]) {
        e.preventDefault();
        handleSelect(flatItems[activeIndex].path);
      }
    },
    [flatItems, activeIndex, handleSelect]
  );

  // Reset active index when the query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll the active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const activeItem = flatItems[activeIndex];
  const activeDescendantId = activeItem ? getPaletteOptionId(activeItem) : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md p-0 gap-0" onKeyDown={handleKeyDown}>
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>
            Search navigation targets and quick actions, then use the arrow keys to choose a
            command.
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center border-b px-3">
          <Search size={14} className="text-muted-foreground mr-2" />
          <Input
            id={COMMAND_PALETTE_INPUT_ID}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={COMMAND_PALETTE_LISTBOX_ID}
            aria-expanded={open}
            aria-activedescendant={activeDescendantId}
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 focus-visible:ring-0 h-11"
            autoFocus
          />
          <kbd className="text-[10px] font-mono text-muted-foreground border rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Items list */}
        <div
          ref={listRef}
          id={COMMAND_PALETTE_LISTBOX_ID}
          role="listbox"
          aria-labelledby={COMMAND_PALETTE_INPUT_ID}
          className="max-h-[300px] overflow-y-auto p-1"
        >
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>
          ) : (
            groupedItems.map((group) => (
              <div key={group.section}>
                <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
                  {group.section}
                </div>
                {group.items.map((item) => {
                  const idx = flatItems.indexOf(item);
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={item.id}
                      id={getPaletteOptionId(item)}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      onClick={() => handleSelect(item.path)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left ${
                        isActive ? "bg-accent" : "hover:bg-accent"
                      }`}
                    >
                      <span className="text-muted-foreground">{item.icon}</span>
                      <span>{item.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{item.path}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Keyboard hints footer */}
        <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground select-none">
          <span className="flex items-center gap-1">
            <kbd className="font-mono border rounded px-1 py-0.5">↑</kbd>
            <kbd className="font-mono border rounded px-1 py-0.5">↓</kbd>
            <span>navigate</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono border rounded px-1 py-0.5">↵</kbd>
            <span>select</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono border rounded px-1 py-0.5">esc</kbd>
            <span>close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
