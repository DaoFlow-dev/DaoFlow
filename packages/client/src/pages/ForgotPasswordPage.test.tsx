// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "./ForgotPasswordPage";

describe("ForgotPasswordPage", () => {
  const fetchMock = vi.fn();

  function renderForgotPasswordPage() {
    return render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <ForgotPasswordPage />
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

  it("shows an inline email validation error before sending the reset request", async () => {
    renderForgotPasswordPage();

    fireEvent.change(screen.getByTestId("forgot-password-email"), {
      target: { value: "invalid-email" }
    });
    fireEvent.click(screen.getByTestId("forgot-password-submit"));

    expect(await screen.findByTestId("forgot-password-email-error")).toHaveTextContent(
      "Enter a valid email address."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves server failures as form-level feedback after field validation passes", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({
        message: "Reset is temporarily unavailable."
      })
    });

    renderForgotPasswordPage();

    fireEvent.change(screen.getByTestId("forgot-password-email"), {
      target: { value: "operator@example.com" }
    });
    fireEvent.click(screen.getByTestId("forgot-password-submit"));

    expect(await screen.findByTestId("forgot-password-feedback")).toHaveTextContent(
      "Reset is temporarily unavailable."
    );
    expect(screen.queryByTestId("forgot-password-email-error")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
