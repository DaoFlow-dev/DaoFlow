// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectEnvironmentDefaultsPanel } from "./ProjectEnvironmentDefaultsPanel";

const { deleteMutate, refetch, upsertMutate } = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  refetch: vi.fn(),
  upsertMutate: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    environmentVariables: {
      useQuery: vi.fn(() => ({
        isLoading: false,
        refetch,
        data: {
          summary: {
            totalVariables: 1,
            projectDefaults: 1,
            secretVariables: 1,
            runtimeVariables: 1,
            buildVariables: 0,
            serviceOverrides: 0,
            previewOverrides: 0,
            resolvedVariables: 1
          },
          variables: [
            {
              id: "projvar_1",
              scope: "project",
              origin: "project",
              scopeLabel: "Project default",
              projectId: "proj_demo",
              projectName: "Demo",
              environmentId: null,
              environmentName: null,
              serviceId: null,
              serviceName: null,
              key: "API_TOKEN",
              displayValue: "raw-project-secret",
              isSecret: true,
              category: "runtime",
              source: "inline",
              secretRef: null,
              branchPattern: null,
              revision: 3,
              originSummary: "Project default",
              updatedByEmail: "owner@example.test",
              updatedAt: "2026-07-19T00:00:00.000Z"
            }
          ],
          resolvedVariables: [],
          previewEnvironment: null
        }
      }))
    },
    upsertEnvironmentVariable: {
      useMutation: vi.fn(() => ({ mutate: upsertMutate, isPending: false, error: null }))
    },
    deleteEnvironmentVariable: {
      useMutation: vi.fn(() => ({ mutate: deleteMutate, isPending: false, error: null }))
    }
  }
}));

describe("ProjectEnvironmentDefaultsPanel", () => {
  afterEach(() => {
    cleanup();
    deleteMutate.mockReset();
    upsertMutate.mockReset();
  });

  it("masks authorized secret values until the user explicitly reveals them", () => {
    render(<ProjectEnvironmentDefaultsPanel projectId="proj_demo" />);

    expect(screen.getByTestId("project-default-row-projvar_1")).toHaveTextContent(
      "Project default"
    );
    expect(screen.getByTestId("project-default-row-projvar_1")).toHaveTextContent("r3");
    expect(screen.getByTestId("project-default-value-projvar_1")).toHaveTextContent("[secret]");
    expect(screen.getByTestId("project-default-value-projvar_1")).not.toHaveTextContent(
      "raw-project-secret"
    );

    fireEvent.click(screen.getByTestId("project-default-reveal-projvar_1"));
    expect(screen.getByTestId("project-default-value-projvar_1")).toHaveTextContent(
      "raw-project-secret"
    );

    fireEvent.click(screen.getByTestId("project-default-reveal-projvar_1"));
    expect(screen.getByTestId("project-default-value-projvar_1")).toHaveTextContent("[secret]");
  });

  it("creates and deletes project defaults through project-scoped mutations", () => {
    render(<ProjectEnvironmentDefaultsPanel projectId="proj_demo" />);

    fireEvent.change(screen.getByTestId("project-default-key-proj_demo"), {
      target: { value: "app url" }
    });
    fireEvent.change(screen.getByTestId("project-default-value-proj_demo"), {
      target: { value: "https://example.test" }
    });
    fireEvent.click(screen.getByTestId("project-default-save-proj_demo"));

    expect(upsertMutate).toHaveBeenCalledWith({
      projectId: "proj_demo",
      scope: "project",
      key: "APP_URL",
      value: "https://example.test",
      isSecret: false,
      category: "runtime"
    });

    fireEvent.click(screen.getByTestId("project-default-delete-projvar_1"));
    expect(deleteMutate).toHaveBeenCalledWith({
      projectId: "proj_demo",
      scope: "project",
      key: "API_TOKEN"
    });
  });
});
