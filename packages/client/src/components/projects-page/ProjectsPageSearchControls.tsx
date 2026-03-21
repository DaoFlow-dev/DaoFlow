import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { ArrowUpDown, Search } from "lucide-react";
import type { ProjectsSortBy } from "@/pages/projects-page/projects-page-types";

interface ProjectsPageSearchControlsProps {
  searchInput: string;
  sortBy: ProjectsSortBy;
  onSearchInputChange: (value: string) => void;
  onSortChange: (value: ProjectsSortBy) => void;
}

export function ProjectsPageSearchControls({
  searchInput,
  sortBy,
  onSearchInputChange,
  onSortChange
}: ProjectsPageSearchControlsProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          data-testid="projects-search-input"
          placeholder="Search projects..."
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          className="pl-9 shadow-sm"
        />
      </div>
      <Select value={sortBy} onValueChange={(value) => onSortChange(value as ProjectsSortBy)}>
        <SelectTrigger className="w-[140px]" data-testid="projects-sort-select">
          <ArrowUpDown size={14} className="mr-1.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="recent">Recent</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
