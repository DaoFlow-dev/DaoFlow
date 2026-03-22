// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TemplatesPage from "./TemplatesPage";

const { infrastructureInventoryUseQueryMock, composeDeploymentPlanUseQueryMock, navigateMock } =
  vi.hoisted(() => ({
    infrastructureInventoryUseQueryMock: vi.fn(),
    composeDeploymentPlanUseQueryMock: vi.fn(),
    navigateMock: vi.fn()
  }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("../lib/trpc", () => ({
  trpc: {
    infrastructureInventory: {
      useQuery: infrastructureInventoryUseQueryMock
    },
    composeDeploymentPlan: {
      useQuery: composeDeploymentPlanUseQueryMock
    }
  }
}));

describe("TemplatesPage", () => {
  const originalFetch = window.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  function renderTemplatesPage() {
    return render(
      <MemoryRouter>
        <TemplatesPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    navigateMock.mockReset();
    infrastructureInventoryUseQueryMock.mockReturnValue({
      data: {
        servers: [
          {
            id: "srv_1",
            name: "foundation",
            host: "203.0.113.10",
            targetKind: "docker-engine"
          }
        ]
      },
      isLoading: false
    });
    composeDeploymentPlanUseQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
      error: null
    });
    fetchMock = vi.fn();
    window.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    window.fetch = originalFetch;
  });

  it("renders the template catalog and the active template details", () => {
    renderTemplatesPage();

    expect(screen.getByTestId("templates-page")).toBeVisible();
    expect(screen.getByTestId("template-card-postgres")).toBeVisible();
    expect(screen.getByTestId("template-active-name")).toHaveTextContent("PostgreSQL");
    expect(screen.getByTestId("template-render-error")).toHaveTextContent("Database password");
  });

  it("switches the active template from the catalog", () => {
    renderTemplatesPage();

    fireEvent.click(screen.getByTestId("template-select-n8n"));

    expect(screen.getByTestId("template-active-name")).toHaveTextContent("n8n");
    expect(screen.getByTestId("template-input-n8n_domain")).toBeVisible();
  });

  it("queues a template deployment through the direct compose endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          deploymentId: "dep_template_123",
          projectId: "proj_template_123",
          environmentId: "env_template_123",
          serviceId: "svc_template_123"
        })
    });

    renderTemplatesPage();

    fireEvent.change(screen.getByTestId("template-input-postgres_password"), {
      target: { value: "super-secret" }
    });
    fireEvent.click(screen.getByTestId("template-apply-button"));

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        "/api/v1/deploy/compose",
        expect.objectContaining({
          method: "POST"
        })
      );
    });

    expect(await screen.findByTestId("template-apply-success")).toHaveTextContent(
      "dep_template_123"
    );

    fireEvent.click(screen.getByTestId("template-open-service-button"));

    expect(navigateMock).toHaveBeenCalledWith("/services/svc_template_123");
  });
});
