// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickSelectOption } from "@/test/select-option";
import { SecuritySettingsTab } from "./SecuritySettingsTab";

const { enableMock, verifyTotpMock, disableMock, generateBackupCodesMock } = vi.hoisted(() => ({
  enableMock: vi.fn(),
  verifyTotpMock: vi.fn(),
  disableMock: vi.fn(),
  generateBackupCodesMock: vi.fn()
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: {
      enable: enableMock,
      verifyTotp: verifyTotpMock,
      disable: disableMock,
      generateBackupCodes: generateBackupCodesMock
    }
  }
}));

describe("SecuritySettingsTab", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders MFA status and updates the team policy", () => {
    let policy: string | null = null;
    render(
      <SecuritySettingsTab
        isLoading={false}
        auditEntries={[]}
        accountSecurity={{
          policy: { mfaRequirement: "optional" },
          user: {
            twoFactorEnabled: false,
            mfaRequired: false,
            mfaSatisfied: true,
            recoveryCodesConfigured: false
          }
        }}
        canManagePolicy={true}
        policyPending={false}
        onPolicyChange={(value) => {
          policy = value;
        }}
        onSecurityRefresh={() => undefined}
      />
    );

    expect(screen.getByTestId("security-mfa-card")).toHaveTextContent("Not enabled");
    fireEvent.click(screen.getByTestId("security-mfa-policy"));
    clickSelectOption(/Required for privileged roles/);

    expect(policy).toBe("privileged");
  });

  it("starts enrollment and shows one-time recovery codes", async () => {
    enableMock.mockResolvedValue({
      data: { backupCodes: ["code-one", "code-two"] }
    });
    render(
      <SecuritySettingsTab
        isLoading={false}
        auditEntries={[]}
        accountSecurity={{
          policy: { mfaRequirement: "privileged" },
          user: {
            twoFactorEnabled: false,
            mfaRequired: true,
            mfaSatisfied: false,
            recoveryCodesConfigured: false
          }
        }}
        canManagePolicy={true}
        policyPending={false}
        onPolicyChange={() => undefined}
        onSecurityRefresh={() => undefined}
      />
    );

    fireEvent.change(screen.getByTestId("security-mfa-password"), {
      target: { value: "secret-password" }
    });
    fireEvent.click(screen.getByTestId("security-mfa-enroll"));

    expect(await screen.findByTestId("security-backup-codes")).toHaveTextContent("code-one");
    expect(enableMock).toHaveBeenCalledWith({ password: "secret-password", issuer: "DaoFlow" });
  });

  it("keeps the team MFA policy read-only without member management access", () => {
    render(
      <SecuritySettingsTab
        isLoading={false}
        auditEntries={[]}
        accountSecurity={{
          policy: { mfaRequirement: "all" },
          user: {
            twoFactorEnabled: true,
            mfaRequired: true,
            mfaSatisfied: true,
            recoveryCodesConfigured: true
          }
        }}
        canManagePolicy={false}
        policyPending={false}
        onPolicyChange={() => {
          throw new Error("policy change should not be called");
        }}
        onSecurityRefresh={() => undefined}
      />
    );

    expect(screen.getByTestId("security-mfa-policy")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("security-mfa-policy-note")).toHaveTextContent(
      "members:manage access"
    );
  });
});
