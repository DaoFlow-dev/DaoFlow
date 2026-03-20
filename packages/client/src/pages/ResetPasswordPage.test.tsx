// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "./ResetPasswordPage";

describe("ResetPasswordPage", () => {
  const fetchMock = vi.fn();

  function renderResetPasswordPage(initialEntry = "/reset-password?token=test-reset-token") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <ResetPasswordPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows inline validation errors before sending a reset request", async () => {
    renderResetPasswordPage();

    fireEvent.change(screen.getByTestId("reset-password-new"), {
      target: { value: "short" }
    });
    fireEvent.change(screen.getByTestId("reset-password-confirm"), {
      target: { value: "different" }
    });
    fireEvent.click(screen.getByTestId("reset-password-submit"));

    expect(await screen.findByTestId("reset-password-new-error")).toHaveTextContent(
      "Use at least 8 characters."
    );
    expect(await screen.findByTestId("reset-password-confirm-error")).toHaveTextContent(
      "Passwords do not match."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows invalid-link feedback when the token is missing", () => {
    renderResetPasswordPage("/reset-password?error=INVALID_TOKEN");

    expect(screen.getByTestId("reset-password-feedback")).toHaveTextContent(
      "This reset link is invalid or has expired. Request a new password reset email."
    );
  });

  it("preserves server failures as form-level feedback after validation passes", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({
        message: "Reset token expired."
      })
    });

    renderResetPasswordPage();

    fireEvent.change(screen.getByTestId("reset-password-new"), {
      target: { value: "new-pass-2026" }
    });
    fireEvent.change(screen.getByTestId("reset-password-confirm"), {
      target: { value: "new-pass-2026" }
    });
    fireEvent.click(screen.getByTestId("reset-password-submit"));

    expect(await screen.findByTestId("reset-password-feedback")).toHaveTextContent(
      "Reset token expired."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts the token and shows success when the password reset completes", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: true })
    });

    renderResetPasswordPage("/reset-password?token=reset-token-123");

    fireEvent.change(screen.getByTestId("reset-password-new"), {
      target: { value: "new-pass-2026" }
    });
    fireEvent.change(screen.getByTestId("reset-password-confirm"), {
      target: { value: "new-pass-2026" }
    });
    fireEvent.click(screen.getByTestId("reset-password-submit"));

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "reset-token-123",
        newPassword: "new-pass-2026"
      })
    });
    expect(await screen.findByTestId("reset-password-success")).toHaveTextContent(
      "Your password has been updated successfully."
    );
  });
});
