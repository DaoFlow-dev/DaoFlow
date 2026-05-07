// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MfaStatusCard } from "./MfaStatusCard";

describe("MfaStatusCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders real account MFA status and navigates to management", () => {
    const onManageMfa = vi.fn();

    render(
      <MfaStatusCard
        isLoading={false}
        accountSecurity={{
          policy: { mfaRequirement: "privileged" },
          user: {
            twoFactorEnabled: true,
            mfaRequired: true,
            mfaSatisfied: true,
            recoveryCodesConfigured: true
          }
        }}
        onManageMfa={onManageMfa}
      />
    );

    expect(screen.getByTestId("profile-mfa-status")).toHaveTextContent("Enabled");
    expect(screen.getByTestId("profile-mfa-required")).toHaveTextContent("Yes");
    expect(screen.getByTestId("profile-mfa-recovery-codes")).toHaveTextContent("Configured");
    expect(screen.getByTestId("profile-mfa-policy")).toHaveTextContent("privileged");

    fireEvent.click(screen.getByRole("button", { name: "Manage MFA" }));
    expect(onManageMfa).toHaveBeenCalledTimes(1);
  });
});
