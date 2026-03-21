import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { trpc } from "../../lib/trpc";
import { useSession } from "../../lib/auth-client";
import { DEFAULT_NEW_PROJECT, filterProjects, sortProjects } from "./projects-page-helpers";
import type { NewProjectDraft, ProjectsPageProject, ProjectsSortBy } from "./projects-page-types";

export function useProjectsPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sortBy, setSortBy] = useState<ProjectsSortBy>("name");
  const [newProject, setNewProject] = useState<NewProjectDraft>(DEFAULT_NEW_PROJECT);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const consumedRouteActionRef = useRef(false);

  const projectsQuery = trpc.projects.useQuery({ limit: 50 }, { enabled: Boolean(session.data) });
  const requestedAction = searchParams.get("action");
  const projects = useMemo(
    () => (projectsQuery.data ?? []) as ProjectsPageProject[],
    [projectsQuery.data]
  );
  const hasProjects = projects.length > 0;
  const filteredProjects = useMemo(() => filterProjects(projects, search), [projects, search]);
  const sortedProjects = useMemo(
    () => sortProjects(filteredProjects, sortBy),
    [filteredProjects, sortBy]
  );
  const showSearchControls = hasProjects || searchInput.length > 0;

  useEffect(() => {
    if (requestedAction !== "new") {
      consumedRouteActionRef.current = false;
      return;
    }

    if (consumedRouteActionRef.current) {
      return;
    }

    consumedRouteActionRef.current = true;
    setDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
  }, [requestedAction, searchParams, setSearchParams]);

  useEffect(
    () => () => {
      clearTimeout(debounceRef.current);
    },
    []
  );

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open);
  }, []);

  const handleSearchInputChange = useCallback((value: string) => {
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 250);
  }, []);

  const handleNewProjectChange = useCallback((field: keyof NewProjectDraft, value: string) => {
    setNewProject((current) => ({
      ...current,
      [field]: value
    }));
  }, []);

  const resetNewProject = useCallback(() => {
    setNewProject(DEFAULT_NEW_PROJECT);
  }, []);

  const handleOpenProject = useCallback(
    (projectId: string) => {
      void navigate(`/projects/${projectId}`);
    },
    [navigate]
  );

  const createProject = trpc.createProject.useMutation({
    onSuccess: () => {
      handleDialogOpenChange(false);
      resetNewProject();
      void projectsQuery.refetch();
    }
  });

  const handleCreateProjectSubmit = useCallback(() => {
    createProject.mutate({
      name: newProject.name,
      description: newProject.description || undefined,
      repoUrl: newProject.repoUrl || undefined
    });
  }, [createProject, newProject]);

  return {
    projectsQuery,
    createProject,
    sortedProjects,
    hasProjects,
    showSearchControls,
    search,
    searchInput,
    dialogOpen,
    sortBy,
    newProject,
    handleDialogOpenChange,
    handleSearchInputChange,
    handleOpenProject,
    handleCreateProjectSubmit,
    handleNewProjectChange,
    setSortBy
  };
}
