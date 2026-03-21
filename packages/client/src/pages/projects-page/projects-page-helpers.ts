import type { NewProjectDraft, ProjectsPageProject, ProjectsSortBy } from "./projects-page-types";

export const DEFAULT_NEW_PROJECT: NewProjectDraft = {
  name: "",
  description: "",
  repoUrl: ""
};

export function filterProjects(
  projects: ProjectsPageProject[],
  search: string
): ProjectsPageProject[] {
  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return projects;
  }

  return projects.filter((project) =>
    String(project.name).toLowerCase().includes(normalizedSearch)
  );
}

export function sortProjects(
  projects: ProjectsPageProject[],
  sortBy: ProjectsSortBy
): ProjectsPageProject[] {
  return [...projects].sort((left, right) => {
    if (sortBy === "name") {
      return String(left.name).localeCompare(String(right.name));
    }

    const leftCreatedAt = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightCreatedAt = right.createdAt ? new Date(right.createdAt).getTime() : 0;

    return rightCreatedAt - leftCreatedAt;
  });
}
