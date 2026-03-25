// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceHeader from "./ServiceHeader";

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

describe("ServiceHeader", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    navigateMock.mockReset();
  });

  it("routes deploy actions into the preview-first deploy surface", () => {
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
          environmentName="Production"
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Production")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

    expect(navigateMock).toHaveBeenCalledWith("/deploy?source=service&serviceId=svc_api");
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
          environmentName="Production"
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: "Restart service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Redeploy service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete service" })).toBeNull();
  });
});
