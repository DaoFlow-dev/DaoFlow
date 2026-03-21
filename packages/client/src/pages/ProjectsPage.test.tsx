// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectsPage from "./ProjectsPage";

const { createProjectUseMutationMock, navigateMock, projectsUseQueryMock } = vi.hoisted(() => ({
  createProjectUseMutationMock: vi.fn(),
  navigateMock: vi.fn(),
  projectsUseQueryMock: vi.fn()
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user_1"
      }
    }
  })
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    projects: {
      useQuery: projectsUseQueryMock
    },
    createProject: {
      useMutation: createProjectUseMutationMock
    }
  }
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

describe("ProjectsPage", () => {
  const refetchMock = vi.fn();
  const createProjectMutateMock = vi.fn();

  function renderProjectsPage(initialEntry = "/projects") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <ProjectsPage />
      </MemoryRouter>
    );
  }

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    navigateMock.mockReset();
    refetchMock.mockReset();
    createProjectMutateMock.mockReset();

    projectsUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: refetchMock
    });
    createProjectUseMutationMock.mockImplementation((options?: { onSuccess?: () => void }) => ({
      error: null,
      isPending: false,
      mutate: createProjectMutateMock,
      options
    }));
  });

  it("renders a guided first-run empty state when no projects exist", () => {
    renderProjectsPage();

    const emptyState = screen.getByTestId("projects-empty-state");

    expect(emptyState).toBeInTheDocument();
    expect(
      within(emptyState).getByRole("heading", { name: "Create your first project" })
    ).toBeVisible();
    expect(screen.getByTestId("projects-empty-create-project")).toBeVisible();
    expect(screen.queryByTestId("projects-search-input")).not.toBeInTheDocument();
  });

  it("opens the create-project dialog from the empty-state CTA", async () => {
    renderProjectsPage();

    fireEvent.click(screen.getByTestId("projects-empty-create-project"));

    expect(await screen.findByRole("heading", { name: "Create Project" })).toBeVisible();
  });

  it("opens the create-project dialog when routed with action=new", async () => {
    renderProjectsPage("/projects?action=new");

    expect(await screen.findByRole("heading", { name: "Create Project" })).toBeVisible();
  });

  it("submits the create-project form and resets the dialog after success", async () => {
    renderProjectsPage("/projects?action=new");

    fireEvent.change(await screen.findByTestId("projects-create-name"), {
      target: { value: "Console" }
    });
    fireEvent.change(screen.getByTestId("projects-create-description"), {
      target: { value: "Frontend control plane" }
    });
    fireEvent.change(screen.getByTestId("projects-create-repo-url"), {
      target: { value: "https://github.com/DaoFlow-dev/console" }
    });
    fireEvent.click(screen.getByTestId("projects-create-submit"));

    expect(createProjectMutateMock).toHaveBeenCalledWith({
      name: "Console",
      description: "Frontend control plane",
      repoUrl: "https://github.com/DaoFlow-dev/console"
    });

    const createProjectMutation = createProjectUseMutationMock.mock.results.at(-1)?.value as {
      options?: {
        onSuccess?: () => void;
      };
    };

    createProjectMutation.options?.onSuccess?.();

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Create Project" })).not.toBeInTheDocument();
    });
    expect(refetchMock).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("projects-new-project-trigger"));

    expect(await screen.findByTestId("projects-create-name")).toHaveValue("");
    expect(screen.getByTestId("projects-create-description")).toHaveValue("");
    expect(screen.getByTestId("projects-create-repo-url")).toHaveValue("");
  });

  it("navigates to the selected project from the rendered card list", () => {
    projectsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "proj_1",
          name: "Console",
          createdAt: "2026-03-21T00:00:00.000Z",
          sourceType: "compose",
          status: "healthy",
          repoFullName: "DaoFlow-dev/console",
          environmentCount: 2,
          serviceCount: 4,
          defaultBranch: "main"
        }
      ],
      isLoading: false,
      refetch: refetchMock
    });

    renderProjectsPage();

    fireEvent.click(screen.getByTestId("project-card-proj_1"));

    expect(navigateMock).toHaveBeenCalledWith("/projects/proj_1");
  });
});
