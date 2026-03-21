import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import {
  ALL_ITEMS,
  buildRecentItems,
  COMMAND_PALETTE_INPUT_ID,
  COMMAND_PALETTE_LISTBOX_ID,
  getPaletteOptionId
} from "@/components/command-palette/data";
import { loadRecentPages, saveRecentPage } from "@/components/command-palette/storage";
import type { PaletteItem } from "@/components/command-palette/types";

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
  const recentItems: PaletteItem[] = useMemo(() => buildRecentItems(recentPages), [recentPages]);

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
                  const ItemIcon = item.icon;
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
                      <span className="text-muted-foreground">
                        <ItemIcon size={14} />
                      </span>
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
