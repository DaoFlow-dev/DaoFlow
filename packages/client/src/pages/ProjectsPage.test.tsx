// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectsPage from "./ProjectsPage";

const {
  createProjectUseMutationMock,
  gitInstallationsUseQueryMock,
  gitProvidersUseQueryMock,
  navigateMock,
  projectsUseQueryMock
} = vi.hoisted(() => ({
  createProjectUseMutationMock: vi.fn(),
  gitInstallationsUseQueryMock: vi.fn(),
  gitProvidersUseQueryMock: vi.fn(),
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
    },
    gitProviders: {
      useQuery: gitProvidersUseQueryMock
    },
    gitInstallations: {
      useQuery: gitInstallationsUseQueryMock
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
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    navigateMock.mockReset();
    refetchMock.mockReset();
    createProjectMutateMock.mockReset();
    gitProvidersUseQueryMock.mockReset();
    gitInstallationsUseQueryMock.mockReset();

    projectsUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: refetchMock
    });
    gitProvidersUseQueryMock.mockReturnValue({
      data: []
    });
    gitInstallationsUseQueryMock.mockReturnValue({
      data: []
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
      repoUrl: "https://github.com/DaoFlow-dev/console",
      defaultBranch: "main"
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

  it("submits repository credentials from the create-project form", async () => {
    renderProjectsPage("/projects?action=new");

    fireEvent.change(await screen.findByTestId("projects-create-name"), {
      target: { value: "Private Console" }
    });
    fireEvent.change(screen.getByTestId("projects-create-repo-url"), {
      target: { value: "git@git.example.com:acme/private-console.git" }
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Repository Credential" }));
    fireEvent.click(screen.getByRole("option", { name: "SSH key" }));
    fireEvent.change(screen.getByTestId("projects-create-repo-credential-ssh-key"), {
      target: {
        value: "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----"
      }
    });
    fireEvent.click(screen.getByTestId("projects-create-submit"));

    expect(createProjectMutateMock).toHaveBeenCalledWith({
      name: "Private Console",
      repoUrl: "git@git.example.com:acme/private-console.git",
      defaultBranch: "main",
      repositoryCredential: {
        kind: "ssh_key",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----"
      }
    });
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("submits provider-linked source settings from the create-project form", async () => {
    gitProvidersUseQueryMock.mockReturnValue({
      data: [
        {
          id: "gitprov_1",
          type: "github",
          name: "DaoFlow GitHub App",
          status: "active"
        }
      ]
    });
    gitInstallationsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "gitinst_1",
          providerId: "gitprov_1",
          installationId: "123",
          accountName: "DaoFlow-dev",
          accountType: "organization",
          status: "active"
        }
      ]
    });

    renderProjectsPage("/projects?action=new");

    fireEvent.change(await screen.findByTestId("projects-create-name"), {
      target: { value: "Console" }
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Git Provider" }));
    fireEvent.click(screen.getByRole("option", { name: "DaoFlow GitHub App - github" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Git Installation" }));
    fireEvent.click(screen.getByRole("option", { name: "DaoFlow-dev (organization)" }));
    fireEvent.change(screen.getByTestId("projects-create-repo-full-name"), {
      target: { value: "DaoFlow-dev/console" }
    });
    fireEvent.change(screen.getByTestId("projects-create-compose-path"), {
      target: { value: "deploy/compose.yaml" }
    });
    fireEvent.click(screen.getByTestId("projects-create-auto-deploy"));
    fireEvent.change(screen.getByTestId("projects-create-auto-deploy-branch"), {
      target: { value: "main" }
    });
    fireEvent.click(screen.getByTestId("projects-create-submit"));

    expect(createProjectMutateMock).toHaveBeenCalledWith({
      name: "Console",
      gitProviderId: "gitprov_1",
      gitInstallationId: "gitinst_1",
      repoFullName: "DaoFlow-dev/console",
      defaultBranch: "main",
      composePath: "deploy/compose.yaml",
      autoDeploy: true,
      autoDeployBranch: "main"
    });
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
