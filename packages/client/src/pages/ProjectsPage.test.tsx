// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectsPage from "./ProjectsPage";

const { createProjectUseMutationMock, projectsUseQueryMock } = vi.hoisted(() => ({
  createProjectUseMutationMock: vi.fn(),
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

describe("ProjectsPage", () => {
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
    projectsUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn()
    });
    createProjectUseMutationMock.mockReturnValue({
      error: null,
      isPending: false,
      mutate: vi.fn()
    });
  });

  it("renders a guided first-run empty state when no projects exist", () => {
    renderProjectsPage();

    const emptyState = screen.getByTestId("projects-empty-state");

    expect(emptyState).toBeInTheDocument();
    expect(
      within(emptyState).getByRole("heading", { name: "Create your first project" })
    ).toBeVisible();
    expect(screen.getByTestId("projects-empty-create-project")).toBeVisible();
    expect(screen.queryByPlaceholderText("Search projects...")).not.toBeInTheDocument();
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
});
