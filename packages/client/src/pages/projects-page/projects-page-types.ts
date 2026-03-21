export interface NewProjectDraft {
  name: string;
  description: string;
  repoUrl: string;
}

export interface ProjectsPageProject {
  id: string | number;
  name: string;
  createdAt?: string | null;
  sourceType?: string | null;
  status: string;
  repoFullName?: string | null;
  repoUrl?: string | null;
  environmentCount?: number | null;
  serviceCount?: number | null;
  defaultBranch?: string | null;
}

export type ProjectsSortBy = "name" | "recent";
