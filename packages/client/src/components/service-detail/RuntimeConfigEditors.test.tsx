// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdvancedTab from "./AdvancedTab";
import ComposeEditorTab from "./ComposeEditorTab";
import { HealthCheckCard } from "./HealthCheckCard";
import { ResourceLimitsCard } from "./ResourceLimitsCard";
import { RestartPolicyCard } from "./RestartPolicyCard";
import { VolumesCard } from "./VolumesCard";

const { mutateAsyncMock, updateServiceRuntimeConfigUseMutationMock, onSavedMock } = vi.hoisted(
  () => ({
    mutateAsyncMock: vi.fn(),
    updateServiceRuntimeConfigUseMutationMock: vi.fn(),
    onSavedMock: vi.fn()
  })
);

vi.mock("@/lib/trpc", () => ({
  trpc: {
    updateServiceRuntimeConfig: {
      useMutation: updateServiceRuntimeConfigUseMutationMock
    }
  }
}));

describe("service runtime config editors", () => {
  beforeEach(() => {
    mutateAsyncMock.mockReset();
    onSavedMock.mockReset();
    mutateAsyncMock.mockResolvedValue({});
    onSavedMock.mockResolvedValue(undefined);
    updateServiceRuntimeConfigUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: mutateAsyncMock
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
