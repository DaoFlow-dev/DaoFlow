import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

interface DeploymentsFiltersProps {
  searchQuery: string;
  statusFilter: string;
  onSearchQueryChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
}

export function DeploymentsFilters({
  searchQuery,
  statusFilter,
  onSearchQueryChange,
  onStatusFilterChange
}: DeploymentsFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[200px] flex-1">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search by service name..."
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-9"
        />
      </div>
      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="healthy">Healthy</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="running">Running</SelectItem>
          <SelectItem value="queued">Queued</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
