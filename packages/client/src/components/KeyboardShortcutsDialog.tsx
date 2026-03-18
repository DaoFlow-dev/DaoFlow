import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";

const shortcuts = [
  { keys: ["⌘", "K"], description: "Open command palette" },
  { keys: ["⌘", "S"], description: "Save changes" },
  { keys: ["?"], description: "Show keyboard shortcuts" },
  { keys: ["G", "D"], description: "Go to Dashboard" },
  { keys: ["G", "P"], description: "Go to Projects" },
  { keys: ["G", "S"], description: "Go to Servers" }
];

export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Keyboard shortcuts (?)">
          <Keyboard size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard size={16} />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {shortcuts.map((s) => (
            <div key={s.description} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.description}</span>
              <div className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border bg-muted px-1.5 text-xs font-mono"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
