import type { LucideIcon } from "lucide-react";

export interface PaletteItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  section: string;
}
