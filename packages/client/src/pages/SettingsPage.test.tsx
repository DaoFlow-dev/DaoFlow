// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./SettingsPage";

const {
  auditTrailUseQueryMock,
  accountSecurityStatusUseQueryMock,
  agentTokenInventoryUseQueryMock,
  inviteUserUseMutationMock,
  operationalMaintenanceReportUseQueryMock,
  principalInventoryUseQueryMock,
  runOperationalMaintenanceUseMutationMock,
  securitySettingsTabMock,
  updateAccountSecurityPolicyUseMutationMock,
  viewerUseQueryMock
} = vi.hoisted(() => ({
  auditTrailUseQueryMock: vi.fn(),
  accountSecurityStatusUseQueryMock: vi.fn(),
  agentTokenInventoryUseQueryMock: vi.fn(),
  inviteUserUseMutationMock: vi.fn(),
  operationalMaintenanceReportUseQueryMock: vi.fn(),
  principalInventoryUseQueryMock: vi.fn(),
  runOperationalMaintenanceUseMutationMock: vi.fn(),
  securitySettingsTabMock: vi.fn(),
  updateAccountSecurityPolicyUseMutationMock: vi.fn(),
  viewerUseQueryMock: vi.fn()
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user_1"
      }
    },
    refetch: vi.fn()
  })
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      principalInventory: {
        invalidate: vi.fn()
      }
    }),
    viewer: {
      useQuery: viewerUseQueryMock
    },
    agentTokenInventory: {
      useQuery: agentTokenInventoryUseQueryMock
    },
    principalInventory: {
      useQuery: principalInventoryUseQueryMock
    },
    auditTrail: {
      useQuery: auditTrailUseQueryMock
    },
    accountSecurityStatus: {
      useQuery: accountSecurityStatusUseQueryMock
    },
    operationalMaintenanceReport: {
      useQuery: operationalMaintenanceReportUseQueryMock
    },
    runOperationalMaintenance: {
      useMutation: runOperationalMaintenanceUseMutationMock
    },
    inviteUser: {
      useMutation: inviteUserUseMutationMock
    },
    updateAccountSecurityPolicy: {
      useMutation: updateAccountSecurityPolicyUseMutationMock
    }
  }
}));

vi.mock("@/components/settings/SecuritySettingsTab", () => ({
  SecuritySettingsTab: (props: { auditEntries: Record<string, unknown>[] }) => {
    securitySettingsTabMock(props);
    return <div data-testid="settings-security-audit-count">{props.auditEntries.length}</div>;
  }
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    securitySettingsTabMock.mockClear();
    viewerUseQueryMock.mockReturnValue({
      data: {
        principal: {
          email: "owner@example.com"
        },
        authz: {
          role: "owner",
          capabilities: [
            "members:manage",
            "tokens:manage",
            "server:write",
            "volumes:write",
            "events:read"
          ]
        },
        session: {
          expiresAt: "2026-05-08T00:00:00.000Z"
        }
      }
    });
    agentTokenInventoryUseQueryMock.mockReturnValue({ data: null, isLoading: false });
    principalInventoryUseQueryMock.mockReturnValue({ data: null, isLoading: false });
    auditTrailUseQueryMock.mockReturnValue({
      data: {
        summary: {
          totalEntries: 1
        },
        entries: [
          {
            id: "audit_1",
            action: "account.security_policy.update",
            outcome: "success",
            createdAt: "2026-05-07T18:00:00.000Z"
          }
        ]
      },
      isLoading: false,
      refetch: vi.fn()
    });
    accountSecurityStatusUseQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
      refetch: vi.fn()
    });
    operationalMaintenanceReportUseQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
      refetch: vi.fn()
    });
    runOperationalMaintenanceUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn()
    });
    inviteUserUseMutationMock.mockReturnValue({
      status: "idle",
      mutate: vi.fn()
    });
    updateAccountSecurityPolicyUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("passes audit trail entries to the security settings tab", () => {
    render(
      <MemoryRouter initialEntries={["/settings?tab=security"]}>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("settings-security-audit-count")).toHaveTextContent("1");
    expect(securitySettingsTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auditEntries: [
          expect.objectContaining({
            id: "audit_1",
            action: "account.security_policy.update"
          })
        ]
      })
    );
  });

  it("hides admin-only tabs for non-admin viewers and falls back to general settings", () => {
    viewerUseQueryMock.mockReturnValueOnce({
      data: {
        principal: {
          email: "viewer@example.com"
        },
        authz: {
          role: "viewer",
          capabilities: ["server:read", "deploy:read", "events:read"]
        },
        session: {
          expiresAt: "2026-05-08T00:00:00.000Z"
        }
      }
    });

    render(
      <MemoryRouter initialEntries={["/settings?tab=tokens"]}>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("General Settings")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Users/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Tokens/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Operations/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Registries/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Git Providers/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Secret Providers/ })).toBeNull();
    expect(screen.queryByText("No API tokens created yet.")).toBeNull();
    expect(agentTokenInventoryUseQueryMock).toHaveBeenCalledWith(undefined, { enabled: false });
    expect(principalInventoryUseQueryMock).toHaveBeenCalledWith(undefined, { enabled: false });
  });
});
