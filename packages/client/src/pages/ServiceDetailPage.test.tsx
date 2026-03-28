// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceDetailPage from "./ServiceDetailPage";

const {
  serviceDetailsUseQueryMock,
  viewerUseQueryMock,
  useSessionMock,
  serviceHeaderMock,
  generalTabMock,
  deploymentsTabMock,
  terminalTabMock,
  environmentTabMock,
  domainsTabMock,
  advancedTabMock,
  activityTabMock,
  logsTabMock,
  monitoringTabMock,
  composeEditorTabMock
} = vi.hoisted(() => ({
  serviceDetailsUseQueryMock: vi.fn(),
  viewerUseQueryMock: vi.fn(),
  useSessionMock: vi.fn(),
  serviceHeaderMock: vi.fn(({ service }: { service: { name: string } }) => (
    <div data-testid="service-header">Header {service.name}</div>
  )),
  generalTabMock: vi.fn(({ service }: { service: { name: string } }) => (
    <div data-testid="general-tab">General {service.name}</div>
  )),
  deploymentsTabMock: vi.fn(({ serviceName }: { serviceName: string }) => (
    <div data-testid="deployments-tab">Deployments {serviceName}</div>
  )),
  terminalTabMock: vi.fn(({ serviceId }: { serviceId: string }) => (
    <div data-testid="terminal-tab">Terminal {serviceId}</div>
  )),
  environmentTabMock: vi.fn(({ serviceId }: { serviceId: string }) => (
    <div data-testid="environment-tab">Environment {serviceId}</div>
  )),
  domainsTabMock: vi.fn(({ serviceName }: { serviceName: string }) => (
    <div data-testid="domains-tab">Domains {serviceName}</div>
  )),
  advancedTabMock: vi.fn(({ serviceId }: { serviceId: string }) => (
    <div data-testid="advanced-tab">Advanced {serviceId}</div>
  )),
  activityTabMock: vi.fn(({ serviceId }: { serviceId: string }) => (
    <div data-testid="activity-tab">Activity {serviceId}</div>
  )),
  logsTabMock: vi.fn(({ serviceName }: { serviceName: string }) => (
    <div data-testid="lazy-logs-tab">Logs {serviceName}</div>
  )),
  monitoringTabMock: vi.fn(({ serviceName }: { serviceName: string }) => (
    <div data-testid="lazy-monitoring-tab">Monitoring {serviceName}</div>
  )),
  composeEditorTabMock: vi.fn(({ serviceName }: { serviceName: string }) => (
    <div data-testid="lazy-compose-tab">Compose {serviceName}</div>
  ))
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    viewer: {
      useQuery: viewerUseQueryMock
    },
    serviceDetails: {
      useQuery: serviceDetailsUseQueryMock
    }
  }
}));

vi.mock("../lib/auth-client", () => ({
  useSession: useSessionMock
}));

vi.mock("../components/service-detail/ServiceHeader", () => ({
  default: serviceHeaderMock
}));

vi.mock("../components/service-detail/GeneralTab", () => ({
  default: generalTabMock
}));

vi.mock("../components/service-detail/DeploymentsTab", () => ({
  default: deploymentsTabMock
}));

vi.mock("../components/service-detail/TerminalTab", () => ({
  default: terminalTabMock
}));

vi.mock("../components/service-detail/EnvironmentTab", () => ({
  default: environmentTabMock
}));

vi.mock("../components/service-detail/DomainsTab", () => ({
  default: domainsTabMock
}));

vi.mock("../components/service-detail/AdvancedTab", () => ({
  default: advancedTabMock
}));

vi.mock("../components/service-detail/ActivityTab", () => ({
  default: activityTabMock
}));

vi.mock("../components/service-detail/LogsTab", () => ({
  default: logsTabMock
}));

vi.mock("../components/service-detail/MonitoringTab", () => ({
  default: monitoringTabMock
}));

vi.mock("../components/service-detail/ComposeEditorTab", () => ({
  default: composeEditorTabMock
}));

const baseServiceData = {
  id: "svc_api",
  name: "api",
  slug: "api",
  sourceType: "compose",
  status: "healthy",
  statusTone: "healthy",
  projectId: "proj_1",
  projectName: "Console",
  environmentId: "env_1",
  environmentName: "Production",
  imageReference: null,
  dockerfilePath: null,
  composeServiceName: "api",
  port: "3000",
  healthcheckPath: "/health",
  replicaCount: "1",
  targetServerId: "srv_1",
  createdAt: "2026-03-20T00:00:00.000Z",
  updatedAt: "2026-03-20T00:00:00.000Z",
  runtimeConfig: null,
  runtimeConfigPreview: "services:\n  api:\n    image: ghcr.io/example/api:latest\n",
  runtimeSummary: {
    statusLabel: "Healthy",
    statusTone: "healthy",
    summary: "Serving traffic normally.",
    observedAt: "2026-03-20T00:00:00.000Z"
  },
  latestDeployment: {
    id: "dep_1",
    statusLabel: "Failed",
    statusTone: "failed",
    summary: "Image pull failed on the target server.",
    failureAnalysis: "Deployment progress heartbeat timed out.",
    targetServerName: "foundation",
    imageTag: "ghcr.io/example/api:sha-123",
    finishedAt: "2026-03-20T00:00:00.000Z"
  }
};

describe("ServiceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionMock.mockReturnValue({
      data: {
        user: {
          id: "user_1"
        }
      }
    });
    viewerUseQueryMock.mockReturnValue({
      data: {
        authz: {
          capabilities: ["logs:read", "terminal:open"]
        }
      },
      isLoading: false
    });
    serviceDetailsUseQueryMock.mockReturnValue({
      data: baseServiceData,
      isLoading: false,
      refetch: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/services/svc_api"]}>
        <Routes>
          <Route path="/services/:id" element={<ServiceDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders eager tabs immediately and lazy-loads heavy tabs on demand", async () => {
    renderPage();

    expect(screen.getByTestId("service-header")).toHaveTextContent("Header api");
    expect(screen.getByTestId("service-recovery-panel")).toBeVisible();
    expect(screen.getByTestId("service-recovery-alert")).toHaveTextContent("Recovery path ready");
    expect(screen.getByTestId("service-recovery-alert")).toHaveTextContent(
      "Deployment progress heartbeat timed out."
    );
    expect(screen.getByTestId("general-tab")).toHaveTextContent("General api");
    expect(logsTabMock).not.toHaveBeenCalled();
    expect(monitoringTabMock).not.toHaveBeenCalled();
    expect(composeEditorTabMock).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /logs/i }));
    fireEvent.click(screen.getByRole("tab", { name: /logs/i }));
    expect(await screen.findByTestId("lazy-logs-tab")).toHaveTextContent("Logs api");
    expect(logsTabMock).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /monitoring/i }));
    fireEvent.click(screen.getByRole("tab", { name: /monitoring/i }));
    expect(await screen.findByTestId("lazy-monitoring-tab")).toHaveTextContent("Monitoring api");
    expect(monitoringTabMock).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /compose/i }));
    fireEvent.click(screen.getByRole("tab", { name: /compose/i }));
    expect(await screen.findByTestId("lazy-compose-tab")).toHaveTextContent("Compose api");
    expect(composeEditorTabMock).toHaveBeenCalledTimes(1);
  });

  it("opens deployment history from the recovery panel", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("service-recovery-open-deployments"));

    expect(await screen.findByTestId("deployments-tab")).toHaveTextContent("Deployments api");
  });

  it("shows the live terminal tab when the viewer has terminal access", async () => {
    renderPage();

    fireEvent.mouseDown(screen.getByTestId("service-detail-terminal-trigger"));
    fireEvent.click(screen.getByTestId("service-detail-terminal-trigger"));

    expect(await screen.findByTestId("terminal-tab")).toHaveTextContent("Terminal svc_api");
    expect(screen.queryByTestId("terminal-access-blocked-alert")).not.toBeInTheDocument();
  });

  it("explains terminal restrictions instead of opening a blocked terminal session", async () => {
    viewerUseQueryMock.mockReturnValue({
      data: {
        authz: {
          capabilities: ["logs:read", "deploy:start"]
        }
      },
      isLoading: false
    });

    renderPage();

    expect(screen.getByTestId("service-detail-terminal-restricted-badge")).toHaveTextContent(
      "Restricted"
    );

    fireEvent.mouseDown(screen.getByTestId("service-detail-terminal-trigger"));
    fireEvent.click(screen.getByTestId("service-detail-terminal-trigger"));

    expect(await screen.findByTestId("terminal-access-blocked-alert")).toHaveTextContent(
      "Terminal access needs a separate permission."
    );
    expect(screen.getByTestId("terminal-access-help")).toHaveTextContent(
      "Ask an owner to handle break-glass troubleshooting"
    );
    expect(terminalTabMock).not.toHaveBeenCalled();
  });

  it("hides the recovery panel when the service is healthy and the last deployment succeeded", () => {
    serviceDetailsUseQueryMock.mockReturnValue({
      data: {
        ...baseServiceData,
        latestDeployment: {
          ...baseServiceData.latestDeployment,
          statusLabel: "Healthy",
          statusTone: "healthy",
          summary: "Deployment completed successfully."
        }
      },
      isLoading: false,
      refetch: vi.fn()
    });

    renderPage();

    expect(screen.queryByTestId("service-recovery-panel")).not.toBeInTheDocument();
  });
});
