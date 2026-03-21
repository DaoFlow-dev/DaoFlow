// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectDetailPage from "./ProjectDetailPage";

const {
  projectDetailsUseQueryMock,
  projectServicesUseQueryMock,
  projectEnvironmentsUseQueryMock,
  infrastructureInventoryUseQueryMock,
  recentDeploymentsUseQueryMock,
  updateProjectUseMutationMock,
  deleteProjectUseMutationMock,
  createEnvironmentUseMutationMock,
  updateEnvironmentUseMutationMock,
  deleteEnvironmentUseMutationMock,
  projectsInvalidateMock,
  navigateMock,
  projectGitCardMock,
  projectOverviewCardsMock,
  projectEnvironmentsPanelMock,
  projectServicesListMock,
  projectSettingsPanelMock,
  addServiceDialogMock
} = vi.hoisted(() => ({
  projectDetailsUseQueryMock: vi.fn(),
  projectServicesUseQueryMock: vi.fn(),
  projectEnvironmentsUseQueryMock: vi.fn(),
  infrastructureInventoryUseQueryMock: vi.fn(),
  recentDeploymentsUseQueryMock: vi.fn(),
  updateProjectUseMutationMock: vi.fn(),
  deleteProjectUseMutationMock: vi.fn(),
  createEnvironmentUseMutationMock: vi.fn(),
  updateEnvironmentUseMutationMock: vi.fn(),
  deleteEnvironmentUseMutationMock: vi.fn(),
  projectsInvalidateMock: vi.fn(),
  navigateMock: vi.fn(),
  projectGitCardMock: vi.fn(() => <div data-testid="project-git-card" />),
  projectOverviewCardsMock: vi.fn(() => <div data-testid="project-overview-cards" />),
  projectEnvironmentsPanelMock: vi.fn(
    ({
      environments,
      onDelete
    }: {
      environments: { id: string; name: string }[];
      onDelete: (environmentId: string) => void;
    }) => (
      <div data-testid="project-environments-panel-mock">
        {environments.map((environment) => (
          <span key={environment.id}>{environment.name}</span>
        ))}
        <button onClick={() => onDelete("env_prod")} data-testid="environment-delete-prod">
          Delete prod
        </button>
      </div>
    )
  ),
  projectServicesListMock: vi.fn(
    ({
      services,
      activeEnv,
      activeEnvName
    }: {
      services: { name: string }[];
      activeEnv: string | null;
      activeEnvName?: string;
    }) => (
      <div data-testid="project-services-list-mock">
        <span data-testid="project-services-active-env">{activeEnv ?? "all"}</span>
        <span data-testid="project-services-active-env-name">{activeEnvName ?? "all"}</span>
        {services.map((service) => (
          <span key={service.name}>{service.name}</span>
        ))}
      </div>
    )
  ),
  projectSettingsPanelMock: vi.fn(
    ({
      editName,
      editDesc,
      onEditName,
      onEditDesc,
      onSave
    }: {
      editName: string;
      editDesc: string;
      onEditName: (value: string) => void;
      onEditDesc: (value: string) => void;
      onSave: () => void;
    }) => (
      <div data-testid="project-settings-panel-mock">
        <span data-testid="project-settings-edit-name">{editName}</span>
        <span data-testid="project-settings-edit-desc">{editDesc}</span>
        <button
          onClick={() => onEditName("  Renamed Project  ")}
          data-testid="project-settings-set-name"
        >
          Set name
        </button>
        <button
          onClick={() => onEditDesc("  Updated description  ")}
          data-testid="project-settings-set-desc"
        >
          Set desc
        </button>
        <button onClick={onSave} data-testid="project-settings-save-mock">
          Save settings
        </button>
      </div>
    )
  ),
  addServiceDialogMock: vi.fn(
    ({
      open,
      projectId,
      environments
    }: {
      open: boolean;
      projectId: string;
      environments: { id: string; name: string }[];
    }) => (
      <div data-testid="add-service-dialog-mock">
        {open ? "open" : "closed"} {projectId}{" "}
        {environments.map((environment) => environment.name).join(",")}
      </div>
    )
  )
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    projectDetails: {
      useQuery: projectDetailsUseQueryMock
    },
    projectServices: {
      useQuery: projectServicesUseQueryMock
    },
    projectEnvironments: {
      useQuery: projectEnvironmentsUseQueryMock
    },
    infrastructureInventory: {
      useQuery: infrastructureInventoryUseQueryMock
    },
    recentDeployments: {
      useQuery: recentDeploymentsUseQueryMock
    },
    updateProject: {
      useMutation: updateProjectUseMutationMock
    },
    deleteProject: {
      useMutation: deleteProjectUseMutationMock
    },
    createEnvironment: {
      useMutation: createEnvironmentUseMutationMock
    },
    updateEnvironment: {
      useMutation: updateEnvironmentUseMutationMock
    },
    deleteEnvironment: {
      useMutation: deleteEnvironmentUseMutationMock
    },
    useUtils: () => ({
      projects: {
        invalidate: projectsInvalidateMock
      }
    })
  }
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("../components/AddServiceDialog", () => ({
  default: addServiceDialogMock
}));

vi.mock("@/components/project/ProjectGitCard", () => ({
  ProjectGitCard: projectGitCardMock
}));

vi.mock("@/components/project/ProjectOverviewCards", () => ({
  ProjectOverviewCards: projectOverviewCardsMock
}));

vi.mock("@/components/project/ProjectEnvironmentsPanel", () => ({
  ProjectEnvironmentsPanel: projectEnvironmentsPanelMock
}));

vi.mock("@/components/project/ProjectServicesList", () => ({
  ProjectServicesList: projectServicesListMock
}));

vi.mock("@/components/project/ProjectSettingsPanel", () => ({
  ProjectSettingsPanel: projectSettingsPanelMock
}));

describe("ProjectDetailPage", () => {
  const projectRefetchMock = vi.fn().mockResolvedValue(undefined);
  const servicesRefetchMock = vi.fn().mockResolvedValue(undefined);
  const environmentsRefetchMock = vi.fn().mockResolvedValue(undefined);
  const updateProjectMutateMock = vi.fn();
  const updateProjectResetMock = vi.fn();
  const deleteProjectMutateMock = vi.fn();
  const deleteProjectResetMock = vi.fn();
  const createEnvironmentMutateMock = vi.fn();
  const createEnvironmentResetMock = vi.fn();
  const updateEnvironmentMutateMock = vi.fn();
  const updateEnvironmentResetMock = vi.fn();
  const deleteEnvironmentMutateMock = vi.fn();
  const deleteEnvironmentResetMock = vi.fn();
  const clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    navigateMock.mockReset();
    projectsInvalidateMock.mockReset();
    projectRefetchMock.mockReset();
    servicesRefetchMock.mockReset();
    environmentsRefetchMock.mockReset();
    updateProjectMutateMock.mockReset();
    updateProjectResetMock.mockReset();
    deleteProjectMutateMock.mockReset();
    deleteProjectResetMock.mockReset();
    createEnvironmentMutateMock.mockReset();
    createEnvironmentResetMock.mockReset();
    updateEnvironmentMutateMock.mockReset();
    updateEnvironmentResetMock.mockReset();
    deleteEnvironmentMutateMock.mockReset();
    deleteEnvironmentResetMock.mockReset();
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });

    projectDetailsUseQueryMock.mockReturnValue({
      data: {
        id: "proj_1",
        name: "DaoFlow",
        repoUrl: "https://github.com/DaoFlow-dev/DaoFlow",
        repoFullName: "DaoFlow-dev/DaoFlow",
        defaultBranch: "main",
        autoDeploy: true,
        config: {
          description: "Project control plane"
        },
        environments: [
          {
            id: "env_prod",
            name: "Production"
          },
          {
            id: "env_stage",
            name: "Staging"
          }
        ]
      },
      isLoading: false,
      refetch: projectRefetchMock
    });
    projectServicesUseQueryMock.mockReturnValue({
      data: [
        {
          id: "svc_api",
          name: "api",
          sourceType: "compose",
          imageReference: null,
          composeServiceName: "api",
          dockerfilePath: null,
          status: "running",
          environmentId: "env_prod"
        },
        {
          id: "svc_worker",
          name: "worker",
          sourceType: "dockerfile",
          imageReference: "ghcr.io/daoflow/worker:latest",
          composeServiceName: null,
          dockerfilePath: "./Dockerfile",
          status: "failed",
          environmentId: "env_stage"
        }
      ],
      isLoading: false,
      refetch: servicesRefetchMock
    });
    projectEnvironmentsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "env_prod",
          name: "Production",
          slug: "production",
          status: "healthy",
          createdAt: "2026-03-20T00:00:00.000Z"
        },
        {
          id: "env_stage",
          name: "Staging",
          slug: "staging",
          status: "healthy",
          createdAt: "2026-03-20T00:00:00.000Z"
        }
      ],
      isLoading: false,
      refetch: environmentsRefetchMock
    });
    infrastructureInventoryUseQueryMock.mockReturnValue({
      data: {
        servers: [
          {
            id: "srv_1",
            name: "foundation-1",
            host: "10.0.0.12"
          }
        ]
      }
    });
    recentDeploymentsUseQueryMock.mockReturnValue({
      data: [
        {
          serviceName: "api",
          createdAt: "2026-03-20T00:00:00.000Z",
          status: "succeeded",
          statusTone: "healthy",
          statusLabel: "Succeeded"
        }
      ]
    });
    updateProjectUseMutationMock.mockImplementation(
      (options?: { onSuccess?: () => Promise<void> }) => ({
        error: null,
        isPending: false,
        mutate: updateProjectMutateMock,
        reset: updateProjectResetMock,
        options
      })
    );
    deleteProjectUseMutationMock.mockImplementation(
      (options?: { onSuccess?: () => Promise<void> }) => ({
        error: null,
        isPending: false,
        mutate: deleteProjectMutateMock,
        reset: deleteProjectResetMock,
        options
      })
    );
    createEnvironmentUseMutationMock.mockReturnValue({
      error: null,
      isPending: false,
      mutate: createEnvironmentMutateMock,
      reset: createEnvironmentResetMock
    });
    updateEnvironmentUseMutationMock.mockReturnValue({
      error: null,
      isPending: false,
      mutate: updateEnvironmentMutateMock,
      reset: updateEnvironmentResetMock
    });
    deleteEnvironmentUseMutationMock.mockImplementation(
      (options?: {
        onSuccess?: (_: unknown, variables: { environmentId: string }) => Promise<void>;
      }) => ({
        error: null,
        isPending: false,
        mutate: deleteEnvironmentMutateMock,
        reset: deleteEnvironmentResetMock,
        options
      })
    );
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/projects/proj_1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("opens settings with the current project values and saves trimmed project edits", () => {
    renderPage();

    fireEvent.click(screen.getByTestId("project-settings-toggle"));

    expect(screen.getByTestId("project-settings-panel-mock")).toBeVisible();
    expect(screen.getByTestId("project-settings-edit-name")).toHaveTextContent("DaoFlow");
    expect(screen.getByTestId("project-settings-edit-desc")).toHaveTextContent(
      "Project control plane"
    );

    fireEvent.click(screen.getByTestId("project-settings-set-name"));
    fireEvent.click(screen.getByTestId("project-settings-set-desc"));
    fireEvent.click(screen.getByTestId("project-settings-save-mock"));

    expect(updateProjectMutateMock).toHaveBeenCalledWith({
      projectId: "proj_1",
      name: "Renamed Project",
      description: "Updated description"
    });
  });

  it("filters services by environment and clears the selected environment after delete success", async () => {
    renderPage();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Production" }));
    fireEvent.click(screen.getByRole("tab", { name: "Production" }));

    expect(screen.getByTestId("project-services-active-env")).toHaveTextContent("env_prod");
    expect(screen.getByTestId("project-services-active-env-name")).toHaveTextContent("Production");
    expect(screen.getByText("api")).toBeVisible();
    expect(screen.queryByText("worker")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("environment-delete-prod"));

    expect(deleteEnvironmentMutateMock).toHaveBeenCalledWith({ environmentId: "env_prod" });

    const deleteEnvironmentMutation = deleteEnvironmentUseMutationMock.mock.results.at(-1)
      ?.value as {
      options?: {
        onSuccess?: (_: unknown, variables: { environmentId: string }) => Promise<void>;
      };
    };

    await deleteEnvironmentMutation.options?.onSuccess?.({}, { environmentId: "env_prod" });

    await waitFor(() => {
      expect(screen.getByTestId("project-services-active-env")).toHaveTextContent("all");
    });
    expect(screen.getByText("worker")).toBeVisible();
    expect(projectRefetchMock).toHaveBeenCalled();
    expect(servicesRefetchMock).toHaveBeenCalled();
    expect(environmentsRefetchMock).toHaveBeenCalled();
    expect(projectsInvalidateMock).toHaveBeenCalled();
  });

  it("copies the project id and opens the add-service dialog with the existing environments", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("project-copy-id"));
    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("proj_1");
    });

    fireEvent.click(screen.getByTestId("project-add-service-button"));

    expect(screen.getByTestId("add-service-dialog-mock")).toHaveTextContent(
      "open proj_1 Production,Staging"
    );
  });

  it("deletes the project and navigates back to the projects list after success", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("project-delete-trigger-proj_1"));
    fireEvent.click(await screen.findByTestId("project-delete-confirm-proj_1"));

    expect(deleteProjectMutateMock).toHaveBeenCalledWith({ projectId: "proj_1" });

    const deleteProjectMutation = deleteProjectUseMutationMock.mock.results[0]?.value as {
      options?: {
        onSuccess?: () => Promise<void>;
      };
    };

    await deleteProjectMutation.options?.onSuccess?.();

    expect(projectsInvalidateMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/projects");
  });
});
