// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SetupWizardPage from "./SetupWizardPage";

const {
  useSessionMock,
  infrastructureInventoryUseQueryMock,
  registerServerUseMutationMock,
  createProjectUseMutationMock,
  createEnvironmentUseMutationMock
} = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  infrastructureInventoryUseQueryMock: vi.fn(),
  registerServerUseMutationMock: vi.fn(),
  createProjectUseMutationMock: vi.fn(),
  createEnvironmentUseMutationMock: vi.fn()
}));

vi.mock("../lib/auth-client", () => ({
  useSession: useSessionMock
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    infrastructureInventory: {
      useQuery: infrastructureInventoryUseQueryMock
    },
    registerServer: {
      useMutation: registerServerUseMutationMock
    },
    createProject: {
      useMutation: createProjectUseMutationMock
    },
    createEnvironment: {
      useMutation: createEnvironmentUseMutationMock
    }
  }
}));

describe("SetupWizardPage", () => {
  const inventoryRefetchMock = vi.fn();
  const registerServerMutateMock = vi.fn();
  const createProjectMutateMock = vi.fn();
  const createEnvironmentMutateMock = vi.fn();

  function renderPage(initialEntry = "/setup") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <SetupWizardPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    inventoryRefetchMock.mockReset();
    registerServerMutateMock.mockReset();
    createProjectMutateMock.mockReset();
    createEnvironmentMutateMock.mockReset();

    useSessionMock.mockReturnValue({
      data: {
        user: {
          id: "user_1"
        }
      },
      isPending: false
    });

    infrastructureInventoryUseQueryMock.mockReturnValue({
      data: {
        servers: [
          {
            id: "srv_foundation",
            name: "foundation",
            host: "203.0.113.10",
            targetKind: "docker-engine"
          }
        ]
      },
      refetch: inventoryRefetchMock
    });

    registerServerUseMutationMock.mockImplementation(
      (options?: { onSuccess?: (server: { id: string; name: string }) => void }) => ({
        isPending: false,
        mutate: registerServerMutateMock,
        options
      })
    );

    createProjectUseMutationMock.mockImplementation(
      (options?: { onSuccess?: (project: { id: string; name: string }) => void }) => ({
        isPending: false,
        mutate: createProjectMutateMock,
        options
      })
    );

    createEnvironmentUseMutationMock.mockImplementation(
      (options?: { onSuccess?: (environment: { id: string; name: string }) => void }) => ({
        isPending: false,
        mutate: createEnvironmentMutateMock,
        options
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("guides an authenticated user through server, project, environment, and handoff", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("setup-welcome-continue"));

    expect(await screen.findByTestId("setup-server-step")).toBeVisible();

    fireEvent.change(screen.getByTestId("setup-server-name"), {
      target: { value: "foundation" }
    });
    fireEvent.change(screen.getByTestId("setup-server-host"), {
      target: { value: "203.0.113.10" }
    });
    fireEvent.change(screen.getByTestId("setup-server-region"), {
      target: { value: "us-west-2" }
    });
    fireEvent.click(screen.getByTestId("setup-server-submit"));

    expect(registerServerMutateMock).toHaveBeenCalledWith({
      name: "foundation",
      host: "203.0.113.10",
      sshPort: 22,
      region: "us-west-2",
      sshUser: "root",
      sshPrivateKey: undefined,
      kind: "docker-engine"
    });

    const registerServerMutation = registerServerUseMutationMock.mock.results.at(-1)?.value as {
      options?: {
        onSuccess?: (server: { id: string; name: string }) => void;
      };
    };

    registerServerMutation.options?.onSuccess?.({
      id: "srv_foundation",
      name: "foundation"
    });

    expect(await screen.findByTestId("setup-project-step")).toBeVisible();

    fireEvent.change(screen.getByTestId("setup-project-name"), {
      target: { value: "Console" }
    });
    fireEvent.change(screen.getByTestId("setup-project-description"), {
      target: { value: "Frontend control plane" }
    });
    fireEvent.change(screen.getByTestId("setup-project-repo"), {
      target: { value: "https://github.com/DaoFlow-dev/console" }
    });
    fireEvent.click(screen.getByTestId("setup-project-submit"));

    expect(createProjectMutateMock).toHaveBeenCalledWith({
      name: "Console",
      description: "Frontend control plane",
      repoUrl: "https://github.com/DaoFlow-dev/console"
    });

    const createProjectMutation = createProjectUseMutationMock.mock.results.at(-1)?.value as {
      options?: {
        onSuccess?: (project: { id: string; name: string }) => void;
      };
    };

    createProjectMutation.options?.onSuccess?.({
      id: "proj_console",
      name: "Console"
    });

    expect(await screen.findByTestId("setup-environment-step")).toBeVisible();

    fireEvent.change(screen.getByTestId("setup-environment-name"), {
      target: { value: "production" }
    });
    fireEvent.click(screen.getByTestId("setup-environment-submit"));

    expect(createEnvironmentMutateMock).toHaveBeenCalledWith({
      projectId: "proj_console",
      name: "production",
      targetServerId: "srv_foundation"
    });

    const createEnvironmentMutation = createEnvironmentUseMutationMock.mock.results.at(-1)
      ?.value as {
      options?: {
        onSuccess?: (environment: { id: string; name: string }) => void;
      };
    };

    createEnvironmentMutation.options?.onSuccess?.({
      id: "env_prod",
      name: "production"
    });

    expect(await screen.findByTestId("setup-handoff-step")).toBeVisible();
    expect(screen.getByText("Console")).toBeVisible();
    expect(screen.getByText("production on foundation")).toBeVisible();
    expect(screen.getByTestId("setup-handoff-project-link")).toHaveAttribute(
      "href",
      "/projects/proj_console"
    );
    expect(screen.getByTestId("setup-handoff-deploy-link")).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/templates?serverId=srv_foundation&serverName=foundation&projectId=proj_console&projectName=Console&environmentId=env_prod&environmentName=production"
      )
    );
  });

  it("redirects unauthenticated protected steps back to the account step", async () => {
    useSessionMock.mockReturnValue({
      data: null,
      isPending: false
    });

    renderPage("/setup?step=environment&serverId=srv_foundation&projectId=proj_console");

    expect(await screen.findByTestId("setup-account-step")).toBeVisible();

    const loginLink = screen.getByTestId("setup-account-login-link");
    expect(loginLink).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/login?returnTo=%2Fsetup%3Fstep%3Denvironment%26serverId%3Dsrv_foundation%26projectId%3Dproj_console"
      )
    );
  });
});
