// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EnvironmentTab from "./EnvironmentTab";

const {
  deleteMutateMock,
  deleteUseMutationMock,
  environmentVariablesUseQueryMock,
  mutateAsyncMock,
  mutateMock,
  refetchMock,
  upsertUseMutationMock
} = vi.hoisted(() => ({
  deleteMutateMock: vi.fn(),
  deleteUseMutationMock: vi.fn(),
  environmentVariablesUseQueryMock: vi.fn(),
  mutateAsyncMock: vi.fn(),
  mutateMock: vi.fn(),
  refetchMock: vi.fn(),
  upsertUseMutationMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    environmentVariables: {
      useQuery: environmentVariablesUseQueryMock
    },
    upsertEnvironmentVariable: {
      useMutation: upsertUseMutationMock
    },
    deleteEnvironmentVariable: {
      useMutation: deleteUseMutationMock
    }
  }
}));

const environmentQueryFixture = {
  summary: {
    totalVariables: 4,
    secretVariables: 1,
    runtimeVariables: 4,
    buildVariables: 0,
    serviceOverrides: 2,
    previewOverrides: 1,
    resolvedVariables: 2
  },
  variables: [
    {
      id: "env_shared_api_url",
      key: "API_URL",
      displayValue: "https://shared.example.test",
      isSecret: false,
      category: "runtime",
      source: "inline",
      scope: "environment",
      scopeLabel: "Shared environment value",
      originSummary: "Shared environment value",
      branchPattern: null
    },
    {
      id: "svc_override_api_url",
      key: "API_URL",
      displayValue: "https://service.example.test",
      isSecret: false,
      category: "runtime",
      source: "inline",
      scope: "service",
      scopeLabel: "Service override",
      originSummary: "Service override",
      branchPattern: null
    },
    {
      id: "env_shared_secret",
      key: "POSTGRES_PASSWORD",
      displayValue: "prod-secret-value",
      isSecret: true,
      category: "runtime",
      source: "inline",
      scope: "environment",
      scopeLabel: "Shared environment value",
      originSummary: "Shared environment value",
      branchPattern: null
    },
    {
      id: "svc_preview_api_url",
      key: "API_URL",
      displayValue: "https://preview.example.test",
      isSecret: false,
      category: "runtime",
      source: "inline",
      scope: "service",
      scopeLabel: "Service preview override",
      originSummary: "Service preview override",
      branchPattern: "preview/*"
    }
  ],
  resolvedVariables: [
    {
      key: "API_URL",
      displayValue: "https://service.example.test",
      isSecret: false,
      category: "runtime",
      source: "inline",
      scope: "service",
      scopeLabel: "Service override",
      originSummary: "Service override",
      branchPattern: null
    },
    {
      key: "POSTGRES_PASSWORD",
      displayValue: "prod-secret-value",
      isSecret: true,
      category: "runtime",
      source: "inline",
      scope: "environment",
      scopeLabel: "Shared environment value",
      originSummary: "Shared environment value",
      branchPattern: null
    }
  ]
};

describe("service environment tab", () => {
  beforeEach(() => {
    refetchMock.mockReset();
    mutateMock.mockReset();
    mutateAsyncMock.mockReset();
    deleteMutateMock.mockReset();

    mutateAsyncMock.mockResolvedValue({});
    refetchMock.mockResolvedValue(undefined);

    environmentVariablesUseQueryMock.mockReturnValue({
      isLoading: false,
      data: environmentQueryFixture,
      refetch: refetchMock
    });
    upsertUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: mutateMock,
      mutateAsync: mutateAsyncMock
    });
    deleteUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: deleteMutateMock
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the resolved value and marks inherited shared rows as read-only", () => {
    render(<EnvironmentTab serviceId="svc_api" environmentId="env_daoflow_staging" />);

    expect(environmentVariablesUseQueryMock).toHaveBeenCalledWith(
      { environmentId: "env_daoflow_staging", serviceId: "svc_api", limit: 100 },
      { enabled: true }
    );
    expect(screen.getByTestId("service-envvar-summary-service-svc_api")).toHaveTextContent("2");
    expect(screen.getByTestId("service-envvar-resolved-svc_api-API_URL")).toHaveTextContent(
      "https://service.example.test"
    );
    expect(screen.getByTestId("service-envvar-shared-note-env_shared_api_url")).toHaveTextContent(
      /add a service override above/i
    );
    expect(
      screen.getByTestId("service-envvar-resolved-value-svc_api-POSTGRES_PASSWORD")
    ).toHaveTextContent("[secret]");
  });

  it("reveals resolved secrets only when requested", () => {
    render(<EnvironmentTab serviceId="svc_api" environmentId="env_daoflow_staging" />);

    fireEvent.click(screen.getByTestId("service-envvar-resolved-reveal-svc_api-POSTGRES_PASSWORD"));

    expect(
      screen.getByTestId("service-envvar-resolved-value-svc_api-POSTGRES_PASSWORD")
    ).toHaveTextContent("prod-secret-value");
  });

  it("sends service-scoped override mutations from table and raw modes", async () => {
    render(<EnvironmentTab serviceId="svc_api" environmentId="env_daoflow_staging" />);

    fireEvent.change(screen.getByTestId("service-envvar-new-key-svc_api"), {
      target: { value: "NEW_FLAG" }
    });
    fireEvent.change(screen.getByTestId("service-envvar-new-value-svc_api"), {
      target: { value: "enabled" }
    });
    fireEvent.change(screen.getByTestId("service-envvar-new-branch-svc_api"), {
      target: { value: "preview/*" }
    });
    fireEvent.click(screen.getByTestId("service-envvar-add-svc_api"));

    expect(mutateMock).toHaveBeenCalledWith({
      environmentId: "env_daoflow_staging",
      serviceId: "svc_api",
      scope: "service",
      key: "NEW_FLAG",
      value: "enabled",
      isSecret: false,
      category: "runtime",
      branchPattern: "preview/*"
    });

    fireEvent.click(screen.getByTestId("service-envvar-delete-svc_override_api_url"));

    expect(deleteMutateMock).toHaveBeenCalledWith({
      environmentId: "env_daoflow_staging",
      serviceId: "svc_api",
      scope: "service",
      key: "API_URL",
      branchPattern: null
    });

    fireEvent.click(screen.getByTestId("service-envvar-mode-raw-svc_api"));
    expect(screen.getByTestId("service-envvar-raw-text")).toHaveValue(
      "API_URL=https://service.example.test"
    );
    expect(screen.getByText(/preview-only overrides stay out of raw mode/i)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("service-envvar-raw-text"), {
      target: { value: "RUNTIME_ONLY=1" }
    });
    fireEvent.click(screen.getByTestId("service-envvar-raw-save"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        environmentId: "env_daoflow_staging",
        serviceId: "svc_api",
        scope: "service",
        key: "RUNTIME_ONLY",
        value: "1",
        isSecret: false,
        category: "runtime"
      });
    });
  });
});
