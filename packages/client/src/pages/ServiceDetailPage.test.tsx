// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceDetailPage from "./ServiceDetailPage";

const {
  serviceDetailsUseQueryMock,
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
    serviceDetails: {
      useQuery: serviceDetailsUseQueryMock
    }
  }
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

describe("ServiceDetailPage", () => {
  beforeEach(() => {
    serviceDetailsUseQueryMock.mockReturnValue({
      data: {
        id: "svc_api",
        name: "api",
        slug: "api",
        sourceType: "compose",
        status: "healthy",
        projectId: "proj_1",
        environmentId: "env_1",
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
        runtimeConfigPreview: "services:\n  api:\n    image: ghcr.io/example/api:latest\n"
      },
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
});
