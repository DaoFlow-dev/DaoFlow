// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DomainsTab from "./DomainsTab";

const {
  serviceDomainStateUseQueryMock,
  addServiceDomainMutateAsyncMock,
  removeServiceDomainMutateAsyncMock,
  setPrimaryServiceDomainMutateAsyncMock,
  updateServicePortMappingsMutateAsyncMock,
  addServiceDomainUseMutationMock,
  removeServiceDomainUseMutationMock,
  setPrimaryServiceDomainUseMutationMock,
  updateServicePortMappingsUseMutationMock,
  invalidateServiceDomainStateMock,
  invalidateServiceDetailsMock
} = vi.hoisted(() => ({
  serviceDomainStateUseQueryMock: vi.fn(),
  addServiceDomainMutateAsyncMock: vi.fn(),
  removeServiceDomainMutateAsyncMock: vi.fn(),
  setPrimaryServiceDomainMutateAsyncMock: vi.fn(),
  updateServicePortMappingsMutateAsyncMock: vi.fn(),
  addServiceDomainUseMutationMock: vi.fn(),
  removeServiceDomainUseMutationMock: vi.fn(),
  setPrimaryServiceDomainUseMutationMock: vi.fn(),
  updateServicePortMappingsUseMutationMock: vi.fn(),
  invalidateServiceDomainStateMock: vi.fn(),
  invalidateServiceDetailsMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      serviceDomainState: {
        invalidate: invalidateServiceDomainStateMock
      },
      serviceDetails: {
        invalidate: invalidateServiceDetailsMock
      }
    }),
    serviceDomainState: {
      useQuery: serviceDomainStateUseQueryMock
    },
    addServiceDomain: {
      useMutation: addServiceDomainUseMutationMock
    },
    removeServiceDomain: {
      useMutation: removeServiceDomainUseMutationMock
    },
    setPrimaryServiceDomain: {
      useMutation: setPrimaryServiceDomainUseMutationMock
    },
    updateServicePortMappings: {
      useMutation: updateServicePortMappingsUseMutationMock
    }
  }
}));

function makeDomainState(
  overrides?: Partial<{
    domains: Array<{
      id: string;
      hostname: string;
      isPrimary: boolean;
      createdAt: string;
      proxyStatus: "matched" | "missing" | "inactive" | "conflict";
      tlsStatus: "ready" | "pending" | "inactive" | "conflict";
      observedRoute: {
        hostname: string;
        service: string;
        path: string | null;
        status: string;
        tunnelId: string;
        tunnelName: string;
      } | null;
    }>;
    portMappings: Array<{
      id: string;
      hostPort: number;
      containerPort: number;
      protocol: "tcp" | "udp";
      createdAt: string;
    }>;
    summary: {
      primaryDomain: string | null;
      desiredDomainCount: number;
      matchedDomainCount: number;
      missingDomainCount: number;
      inactiveDomainCount: number;
      conflictDomainCount: number;
    };
  }>
) {
  return {
    serviceId: "svc_api",
    serviceName: "api",
    domains: [
      {
        id: "dom_primary",
        hostname: "app.example.com",
        isPrimary: true,
        createdAt: "2026-03-20T12:00:00.000Z",
        proxyStatus: "matched" as const,
        tlsStatus: "ready" as const,
        observedRoute: {
          hostname: "app.example.com",
          service: "api",
          path: null,
          status: "active",
          tunnelId: "tun_1",
          tunnelName: "prod-edge"
        }
      }
    ],
    portMappings: [
      {
        id: "pm_1",
        hostPort: 443,
        containerPort: 3000,
        protocol: "tcp" as const,
        createdAt: "2026-03-20T12:00:00.000Z"
      }
    ],
    summary: {
      primaryDomain: "app.example.com",
      desiredDomainCount: 1,
      matchedDomainCount: 1,
      missingDomainCount: 0,
      inactiveDomainCount: 0,
      conflictDomainCount: 0
    },
    ...overrides
  };
}

describe("DomainsTab", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    serviceDomainStateUseQueryMock.mockReset();
    addServiceDomainMutateAsyncMock.mockReset();
    removeServiceDomainMutateAsyncMock.mockReset();
    setPrimaryServiceDomainMutateAsyncMock.mockReset();
    updateServicePortMappingsMutateAsyncMock.mockReset();
    addServiceDomainUseMutationMock.mockReset();
    removeServiceDomainUseMutationMock.mockReset();
    setPrimaryServiceDomainUseMutationMock.mockReset();
    updateServicePortMappingsUseMutationMock.mockReset();
    invalidateServiceDomainStateMock.mockReset();
    invalidateServiceDetailsMock.mockReset();

    invalidateServiceDomainStateMock.mockResolvedValue(undefined);
    invalidateServiceDetailsMock.mockResolvedValue(undefined);
    addServiceDomainMutateAsyncMock.mockResolvedValue({});
    removeServiceDomainMutateAsyncMock.mockResolvedValue({});
    setPrimaryServiceDomainMutateAsyncMock.mockResolvedValue({});
    updateServicePortMappingsMutateAsyncMock.mockResolvedValue({});

    serviceDomainStateUseQueryMock.mockReturnValue({
      data: makeDomainState(),
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });
    addServiceDomainUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: addServiceDomainMutateAsyncMock
    });
    removeServiceDomainUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: removeServiceDomainMutateAsyncMock
    });
    setPrimaryServiceDomainUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: setPrimaryServiceDomainMutateAsyncMock
    });
    updateServicePortMappingsUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: updateServicePortMappingsMutateAsyncMock
    });
  });

  it("renders persisted domain state and observed route details", () => {
    render(<DomainsTab serviceId="svc_api" serviceName="api" />);

    expect(screen.getByTestId("service-domain-hostname-svc_api-dom_primary")).toHaveTextContent(
      "app.example.com"
    );
    expect(screen.getByTestId("service-domain-proxy-svc_api-dom_primary")).toHaveTextContent(
      "Proxy matched"
    );
    expect(screen.getByTestId("service-domain-tls-svc_api-dom_primary")).toHaveTextContent(
      "TLS ready"
    );
    expect(screen.getByTestId("service-domain-summary-primary-svc_api")).toHaveTextContent(
      "app.example.com"
    );
    expect(screen.getByTestId("service-port-row-svc_api-pm_1")).toBeInTheDocument();
    expect(screen.getByTestId("service-proxy-matched-svc_api")).toHaveTextContent("Matched 1");
  });

  it("persists a new hostname through the domain mutation", async () => {
    serviceDomainStateUseQueryMock.mockReturnValue({
      data: makeDomainState({
        domains: [],
        portMappings: [],
        summary: {
          primaryDomain: null,
          desiredDomainCount: 0,
          matchedDomainCount: 0,
          missingDomainCount: 0,
          inactiveDomainCount: 0,
          conflictDomainCount: 0
        }
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<DomainsTab serviceId="svc_api" serviceName="api" />);

    fireEvent.change(screen.getByTestId("service-domain-input-svc_api"), {
      target: { value: "App.Example.com" }
    });
    fireEvent.click(screen.getByTestId("service-domain-add-svc_api"));

    await waitFor(() => {
      expect(addServiceDomainMutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        hostname: "App.Example.com"
      });
    });
    expect(invalidateServiceDomainStateMock).toHaveBeenCalledWith({ serviceId: "svc_api" });
    expect(invalidateServiceDetailsMock).toHaveBeenCalledWith({ serviceId: "svc_api" });
  });

  it("saves edited port mappings through the port-mapping mutation", async () => {
    serviceDomainStateUseQueryMock.mockReturnValue({
      data: makeDomainState({
        portMappings: [],
        summary: {
          primaryDomain: "app.example.com",
          desiredDomainCount: 1,
          matchedDomainCount: 1,
          missingDomainCount: 0,
          inactiveDomainCount: 0,
          conflictDomainCount: 0
        }
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<DomainsTab serviceId="svc_api" serviceName="api" />);

    fireEvent.change(screen.getByTestId("service-port-host-input-svc_api"), {
      target: { value: "443" }
    });
    fireEvent.change(screen.getByTestId("service-port-container-input-svc_api"), {
      target: { value: "3000" }
    });
    fireEvent.click(screen.getByTestId("service-port-add-svc_api"));
    fireEvent.click(screen.getByTestId("service-port-save-svc_api"));

    await waitFor(() => {
      expect(updateServicePortMappingsMutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        portMappings: [
          {
            id: undefined,
            hostPort: 443,
            containerPort: 3000,
            protocol: "tcp"
          }
        ]
      });
    });
  });

  it("keeps unsaved port edits when the query refetches in the background", () => {
    const initialState = makeDomainState();
    serviceDomainStateUseQueryMock.mockReturnValue({
      data: initialState,
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    const { rerender } = render(<DomainsTab serviceId="svc_api" serviceName="api" />);

    fireEvent.change(screen.getByTestId("service-port-row-container-svc_api-pm_1"), {
      target: { value: "4000" }
    });

    serviceDomainStateUseQueryMock.mockReturnValue({
      data: makeDomainState({
        portMappings: [
          {
            id: "pm_1",
            hostPort: 443,
            containerPort: 3000,
            protocol: "tcp",
            createdAt: "2026-03-20T12:05:00.000Z"
          }
        ]
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });
    rerender(<DomainsTab serviceId="svc_api" serviceName="api" />);

    expect(screen.getByTestId("service-port-row-container-svc_api-pm_1")).toHaveValue(4000);
  });

  it("marks a non-primary domain as the primary hostname", async () => {
    serviceDomainStateUseQueryMock.mockReturnValue({
      data: makeDomainState({
        domains: [
          {
            id: "dom_primary",
            hostname: "app.example.com",
            isPrimary: true,
            createdAt: "2026-03-20T12:00:00.000Z",
            proxyStatus: "matched",
            tlsStatus: "ready",
            observedRoute: null
          },
          {
            id: "dom_secondary",
            hostname: "api.example.com",
            isPrimary: false,
            createdAt: "2026-03-20T12:05:00.000Z",
            proxyStatus: "missing",
            tlsStatus: "pending",
            observedRoute: null
          }
        ],
        summary: {
          primaryDomain: "app.example.com",
          desiredDomainCount: 2,
          matchedDomainCount: 1,
          missingDomainCount: 1,
          inactiveDomainCount: 0,
          conflictDomainCount: 0
        }
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });

    render(<DomainsTab serviceId="svc_api" serviceName="api" />);

    fireEvent.click(screen.getByTestId("service-domain-make-primary-svc_api-dom_secondary"));

    await waitFor(() => {
      expect(setPrimaryServiceDomainMutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_api",
        domainId: "dom_secondary"
      });
    });
  });
});
