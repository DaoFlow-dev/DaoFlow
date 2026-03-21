// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceHeader from "./ServiceHeader";

const { deployMutateMock, useTriggerDeployMutationMock } = vi.hoisted(() => ({
  deployMutateMock: vi.fn(),
  useTriggerDeployMutationMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    triggerDeploy: {
      useMutation: useTriggerDeployMutationMock
    }
  }
}));

describe("ServiceHeader", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    deployMutateMock.mockReset();
    useTriggerDeployMutationMock.mockReset();
    useTriggerDeployMutationMock.mockReturnValue({
      mutate: deployMutateMock,
      error: null
    });
  });

  it("shows a loading state while deploy is pending", () => {
    render(
      <MemoryRouter>
        <ServiceHeader
          service={{
            id: "svc_api",
            name: "api",
            sourceType: "compose",
            status: "running",
            projectId: "proj_1"
          }}
          projectName="Demo"
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

    expect(deployMutateMock).toHaveBeenCalledWith({ serviceId: "svc_api" });
    expect(screen.getByRole("button", { name: "Deploying..." })).toBeDisabled();
  });

  it("hides unsupported lifecycle actions that do not have backend support", () => {
    render(
      <MemoryRouter>
        <ServiceHeader
          service={{
            id: "svc_api",
            name: "api",
            sourceType: "compose",
            status: "running",
            projectId: "proj_1"
          }}
          projectName="Demo"
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: "Restart service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Redeploy service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete service" })).toBeNull();
  });
});
