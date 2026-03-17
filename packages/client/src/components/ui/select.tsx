import * as React from "react";
import { cn } from "@/lib/utils";

// ── Select Root ──────────────────────────────────────────
interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

const SelectContext = React.createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

// ── Trigger ──────────────────────────────────────────────
const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
  ({ className, children, ...props }, ref) => {
    const ctx = React.useContext(SelectContext);
    return (
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={ctx.open}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onClick={() => ctx.setOpen(!ctx.open)}
        {...props}
      >
        {children}
        <svg className="h-4 w-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }
);
SelectTrigger.displayName = "SelectTrigger";

// ── Value ────────────────────────────────────────────────
function SelectValue({ placeholder }: { placeholder?: string }) {
  const ctx = React.useContext(SelectContext);
  return (
    <span className={ctx.value ? "" : "text-muted-foreground"}>{ctx.value ?? placeholder}</span>
  );
}

// ── Content ──────────────────────────────────────────────
function SelectContent({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(SelectContext);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!ctx.open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        ctx.setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [ctx, ctx.open]);

  if (!ctx.open) return null;
  return (
    <div
      ref={ref}
      role="listbox"
      className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
    >
      {children}
    </div>
  );
}

// ── Item ─────────────────────────────────────────────────
interface SelectItemProps extends React.ComponentProps<"div"> {
  value: string;
}

function SelectItem({ value, children, className, ...props }: SelectItemProps) {
  const ctx = React.useContext(SelectContext);
  return (
    <div
      role="option"
      aria-selected={ctx.value === value}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        ctx.value === value && "bg-accent text-accent-foreground",
        className
      )}
      onClick={() => {
        ctx.onValueChange?.(value);
        ctx.setOpen(false);
      }}
      {...props}
    >
      {ctx.value === value && (
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {children}
    </div>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
