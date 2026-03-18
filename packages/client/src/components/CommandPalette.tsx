import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  LayoutDashboard,
  FolderKanban,
  Server,
  DatabaseBackup,
  Bell,
  Settings,
  User,
  Search,
  Command
} from "lucide-react";

interface PaletteItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  section: string;
}

const items: PaletteItem[] = [
  {
    id: "dash",
    label: "Dashboard",
    path: "/",
    icon: <LayoutDashboard size={14} />,
    section: "Navigate"
  },
  {
    id: "proj",
    label: "Projects",
    path: "/projects",
    icon: <FolderKanban size={14} />,
    section: "Navigate"
  },
  {
    id: "serv",
    label: "Servers",
    path: "/servers",
    icon: <Server size={14} />,
    section: "Navigate"
  },
  {
    id: "back",
    label: "Backups",
    path: "/backups",
    icon: <DatabaseBackup size={14} />,
    section: "Navigate"
  },
  {
    id: "notif",
    label: "Notifications",
    path: "/notifications",
    icon: <Bell size={14} />,
    section: "Navigate"
  },
  {
    id: "sett",
    label: "Settings",
    path: "/settings",
    icon: <Settings size={14} />,
    section: "Navigate"
  },
  { id: "prof", label: "Profile", path: "/profile", icon: <User size={14} />, section: "Navigate" }
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

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

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.path.toLowerCase().includes(query.toLowerCase())
      ),
    [query]
  );

  function handleSelect(path: string) {
    setOpen(false);
    setQuery("");
    void navigate(path);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md p-0 gap-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
        </DialogHeader>
        <div className="flex items-center border-b px-3">
          <Search size={14} className="text-muted-foreground mr-2" />
          <Input
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
        <div className="max-h-[300px] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelect(item.path)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
              >
                <span className="text-muted-foreground">{item.icon}</span>
                <span>{item.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{item.path}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
