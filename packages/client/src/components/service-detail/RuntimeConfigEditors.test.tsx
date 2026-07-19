// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdvancedTab from "./AdvancedTab";
import ComposeEditorTab from "./ComposeEditorTab";
import { HealthCheckCard } from "./HealthCheckCard";
import { LoggingRotationCard } from "./LoggingRotationCard";
import { ResourceLimitsCard } from "./ResourceLimitsCard";
import { RestartPolicyCard } from "./RestartPolicyCard";
import { VolumesCard } from "./VolumesCard";

const {
  mutateAsyncMock,
  updateServiceRuntimeConfigUseMutationMock,
  serviceLoggingStateUseQueryMock,
  inspectionRefetchMock,
  onSavedMock
} = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  updateServiceRuntimeConfigUseMutationMock: vi.fn(),
  serviceLoggingStateUseQueryMock: vi.fn(),
  inspectionRefetchMock: vi.fn(),
  onSavedMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    updateServiceRuntimeConfig: {
      useMutation: updateServiceRuntimeConfigUseMutationMock
    },
    serviceLoggingState: {
      useQuery: serviceLoggingStateUseQueryMock
    }
  }
}));

describe("service runtime config editors", () => {
  beforeEach(() => {
    mutateAsyncMock.mockReset();
    serviceLoggingStateUseQueryMock.mockReset();
    inspectionRefetchMock.mockReset();
    onSavedMock.mockReset();
    mutateAsyncMock.mockResolvedValue({});
    inspectionRefetchMock.mockResolvedValue({});
    onSavedMock.mockResolvedValue(undefined);
    updateServiceRuntimeConfigUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: mutateAsyncMock
    });
    serviceLoggingStateUseQueryMock.mockReturnValue({
      data: {
        desired: null,
        status: "not-deployed",
        inspectedAt: null,
        containers: []
      },
      isFetching: false,
      isLoading: false,
      refetch: inspectionRefetchMock
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a support gate for non-compose services", () => {
    render(
      <AdvancedTab
        serviceId="svc_image"
        service={{
          sourceType: "image",
          composeServiceName: null,
          healthcheckPath: null,
          port: null
        }}
        runtimeConfig={null}
        onConfigSaved={onSavedMock}
      />
    );

    expect(screen.getByTestId("service-runtime-config-unsupported")).toBeInTheDocument();
    expect(screen.getByText(/only supported for compose services/i)).toBeVisible();
  });

  it("renders a read-only compose override preview without a fake save action", () => {
    render(
      <ComposeEditorTab
        serviceId="svc_api"
        serviceName="api"
        sourceType="compose"
        composeServiceName="api"
        runtimeConfigPreview={"services:\n  api:\n    restart: unless-stopped\n"}
      />
    );

    expect(screen.getByTestId("service-compose-preview-text-svc_api")).toHaveValue(
      "services:\n  api:\n    restart: unless-stopped\n"
    );
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("persists volume overrides through the runtime config mutation", async () => {
    render(<VolumesCard serviceId="svc_api" volumes={[]} onSaved={onSavedMock} />);

    fireEvent.change(screen.getByTestId("service-volume-source-svc_api"), {
      target: { value: "/srv/data" }
    });
    fireEvent.change(screen.getByTestId("service-volume-target-svc_api"), {
      target: { value: "/var/lib/postgresql/data" }
    });
    fireEvent.click(screen.getByTestId("service-volume-add-svc_api"));
    fireEvent.click(screen.getByTestId("service-volume-save-svc_api"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        volumes: [
          {
            source: "/srv/data",
            target: "/var/lib/postgresql/data",
            mode: "rw"
          }
        ]
      });
    });
    expect(onSavedMock).toHaveBeenCalled();
  });

  it("converts numeric resource inputs before saving", async () => {
    render(<ResourceLimitsCard serviceId="svc_api" resources={null} onSaved={onSavedMock} />);

    fireEvent.change(screen.getByTestId("service-resource-cpu-limit-svc_api"), {
      target: { value: "1.5" }
    });
    fireEvent.change(screen.getByTestId("service-resource-memory-limit-svc_api"), {
      target: { value: "768" }
    });
    fireEvent.click(screen.getByTestId("service-resource-save-svc_api"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        resources: {
          cpuLimitCores: 1.5,
          cpuReservationCores: null,
          memoryLimitMb: 768,
          memoryReservationMb: null
        }
      });
    });
    expect(onSavedMock).toHaveBeenCalled();
  });

  it("saves the default managed json-file rotation after enabling it", async () => {
    render(<LoggingRotationCard serviceId="svc_api" logging={null} onSaved={onSavedMock} />);

    fireEvent.click(screen.getByTestId("service-logging-enabled-svc_api"));
    fireEvent.click(screen.getByTestId("service-logging-save-svc_api"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        logging: {
          managed: true,
          driver: "json-file",
          maxSizeMb: 10,
          maxFiles: 3,
          allowSourceOverride: false
        }
      });
    });
    expect(inspectionRefetchMock).toHaveBeenCalledOnce();
    expect(onSavedMock).toHaveBeenCalled();
  });

  it("rejects log rotation values outside the server-compatible bounds", async () => {
    render(<LoggingRotationCard serviceId="svc_api" logging={null} onSaved={onSavedMock} />);

    fireEvent.click(screen.getByTestId("service-logging-enabled-svc_api"));
    fireEvent.change(screen.getByTestId("service-logging-max-size-svc_api"), {
      target: { value: "1025" }
    });
    fireEvent.change(screen.getByTestId("service-logging-max-files-svc_api"), {
      target: { value: "0" }
    });
    fireEvent.click(screen.getByTestId("service-logging-save-svc_api"));

    expect(await screen.findByTestId("service-logging-feedback-svc_api")).toHaveTextContent(
      "size 1–1024 MB and files 1–20"
    );
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("requires an explicit source-ownership choice before replacing Compose logging", async () => {
    render(<LoggingRotationCard serviceId="svc_api" logging={null} onSaved={onSavedMock} />);

    fireEvent.click(screen.getByTestId("service-logging-enabled-svc_api"));
    fireEvent.click(screen.getByTestId("service-logging-source-override-svc_api"));

    expect(screen.getByTestId("service-logging-source-warning-svc_api")).toHaveTextContent(
      "may replace logging already authored in the source Compose service"
    );

    fireEvent.click(screen.getByTestId("service-logging-save-svc_api"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        logging: {
          managed: true,
          driver: "json-file",
          maxSizeMb: 10,
          maxFiles: 3,
          allowSourceOverride: true
        }
      });
    });
  });

  it("clears a persisted managed logging setting", async () => {
    render(
      <LoggingRotationCard
        serviceId="svc_api"
        logging={{
          managed: true,
          driver: "json-file",
          maxSizeMb: 20,
          maxFiles: 5,
          allowSourceOverride: false
        }}
        onSaved={onSavedMock}
      />
    );

    fireEvent.click(screen.getByTestId("service-logging-clear-svc_api"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        logging: null
      });
    });
    expect(onSavedMock).toHaveBeenCalled();
    expect(inspectionRefetchMock).toHaveBeenCalledOnce();
  });

  it("renders inspection state and refreshes it only on demand", async () => {
    serviceLoggingStateUseQueryMock.mockReturnValue({
      data: {
        desired: {
          managed: true,
          driver: "json-file",
          maxSizeMb: 10,
          maxFiles: 3,
          allowSourceOverride: false
        },
        status: "aligned",
        inspectedAt: "2026-07-19T12:00:00.000Z",
        containers: [
          {
            name: "api-1",
            driver: "json-file",
            maxSize: "10m",
            maxFiles: "3",
            matchesDesired: true
          },
          {
            name: "worker-1",
            driver: null,
            maxSize: null,
            maxFiles: null,
            matchesDesired: false
          }
        ]
      },
      isFetching: false,
      isLoading: false,
      refetch: inspectionRefetchMock
    });

    render(<LoggingRotationCard serviceId="svc_api" logging={null} onSaved={onSavedMock} />);

    expect(serviceLoggingStateUseQueryMock).toHaveBeenCalledWith(
      { serviceId: "svc_api" },
      { enabled: false }
    );
    expect(screen.getByTestId("service-logging-desired-svc_api")).toHaveTextContent(
      "json-file, 10 MB, 3 files"
    );
    expect(screen.getByTestId("service-logging-status-svc_api")).toHaveTextContent("Aligned");
    expect(screen.getByTestId("service-logging-inspected-at-svc_api")).toHaveTextContent("2026");
    expect(screen.getByTestId("service-logging-container-driver-svc_api-api-1")).toHaveTextContent(
      "json-file"
    );
    expect(screen.getByTestId("service-logging-container-size-svc_api-api-1")).toHaveTextContent(
      "10m"
    );
    expect(screen.getByTestId("service-logging-container-files-svc_api-api-1")).toHaveTextContent(
      "3"
    );
    expect(
      screen.getByTestId("service-logging-container-driver-svc_api-worker-1")
    ).toHaveTextContent("Not set");
    expect(screen.getByTestId("service-logging-container-match-svc_api-api-1")).toHaveTextContent(
      "Matches desired"
    );

    fireEvent.click(screen.getByTestId("service-logging-refresh-svc_api"));
    await waitFor(() => expect(inspectionRefetchMock).toHaveBeenCalledTimes(1));
  });

  it("explains unavailable Swarm inspection results", () => {
    serviceLoggingStateUseQueryMock.mockReturnValue({
      data: {
        desired: null,
        status: "unavailable",
        inspectedAt: null,
        reason: "Docker log inspection is unsupported for Swarm services.",
        containers: []
      },
      isFetching: false,
      isLoading: false,
      refetch: inspectionRefetchMock
    });

    render(<LoggingRotationCard serviceId="svc_api" logging={null} onSaved={onSavedMock} />);

    expect(screen.getByTestId("service-logging-status-svc_api")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("service-logging-status-svc_api")).toHaveTextContent(
      "not supported for Swarm services"
    );
    expect(screen.getByTestId("service-logging-no-containers-svc_api")).toHaveTextContent(
      "not supported for Swarm services"
    );
  });

  it("clears a persisted restart override through the runtime config mutation", async () => {
    render(
      <RestartPolicyCard
        serviceId="svc_api"
        restartPolicy={{ name: "always", maxRetries: null }}
        onSaved={onSavedMock}
      />
    );

    fireEvent.click(screen.getByTestId("service-restart-clear-svc_api"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        restartPolicy: null
      });
    });
    expect(onSavedMock).toHaveBeenCalled();
  });

  it("clears a persisted health-check override through the runtime config mutation", async () => {
    render(
      <HealthCheckCard
        serviceId="svc_api"
        healthcheckPath="/health"
        port="3000"
        healthCheck={{
          command: "curl -f http://localhost:3000/health",
          intervalSeconds: 30,
          timeoutSeconds: 10,
          retries: 3,
          startPeriodSeconds: 15
        }}
        onSaved={onSavedMock}
      />
    );

    fireEvent.click(screen.getByTestId("service-health-clear-svc_api"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        healthCheck: null
      });
    });
    expect(onSavedMock).toHaveBeenCalled();
  });
});
