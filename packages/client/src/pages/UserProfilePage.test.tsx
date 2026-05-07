// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserProfilePage from "./UserProfilePage";

const { accountSecurityStatusUseQueryMock, navigateMock } = vi.hoisted(() => ({
  accountSecurityStatusUseQueryMock: vi.fn(),
  navigateMock: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com"
      }
    },
    refetch: vi.fn()
  }),
  authClient: {
    updateUser: vi.fn(),
    changePassword: vi.fn(),
    revokeOtherSessions: vi.fn()
  }
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    accountSecurityStatus: {
      useQuery: accountSecurityStatusUseQueryMock
    }
  }
}));

describe("UserProfilePage", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    accountSecurityStatusUseQueryMock.mockReturnValue({
      data: {
        policy: { mfaRequirement: "privileged" },
        user: {
          twoFactorEnabled: true,
          mfaRequired: true,
          mfaSatisfied: true,
          recoveryCodesConfigured: true
        }
      },
      isLoading: false
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders real MFA status and links to security settings", () => {
    render(<UserProfilePage />);

    expect(screen.getByTestId("profile-mfa-status")).toHaveTextContent("Enabled");
    expect(screen.getByTestId("profile-mfa-required")).toHaveTextContent("Yes");

    fireEvent.click(screen.getByRole("button", { name: "Manage MFA" }));
    expect(navigateMock).toHaveBeenCalledWith("/settings?tab=security");
  });
});
