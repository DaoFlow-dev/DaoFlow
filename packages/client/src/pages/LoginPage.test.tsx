// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

const { signInEmailMock, signUpEmailMock, useSessionMock } = vi.hoisted(() => ({
  signInEmailMock: vi.fn(),
  signUpEmailMock: vi.fn(),
  useSessionMock: vi.fn()
}));

vi.mock("../lib/auth-client", () => ({
  signIn: {
    email: signInEmailMock
  },
  signUp: {
    email: signUpEmailMock
  },
  useSession: useSessionMock
}));

describe("LoginPage", () => {
  function renderLoginPage() {
    return render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    useSessionMock.mockReturnValue({
      data: null,
      refetch: vi.fn()
    });
    signInEmailMock.mockResolvedValue({});
    signUpEmailMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it("shows inline sign-in field errors instead of calling auth for invalid input", async () => {
    renderLoginPage();

    fireEvent.click(screen.getByTestId("login-signin-submit"));

    expect(await screen.findByTestId("login-signin-email-error")).toHaveTextContent(
      "Enter your email address."
    );
    expect(screen.getByTestId("login-signin-password-error")).toHaveTextContent(
      "Enter your password."
    );
    expect(signInEmailMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("login-signin-feedback")).not.toBeInTheDocument();
  });

  it("isolates sign-up validation from sign-in state", async () => {
    renderLoginPage();

    fireEvent.mouseDown(screen.getByTestId("login-tab-sign-up"));
    fireEvent.click(screen.getByTestId("login-tab-sign-up"));

    fireEvent.change(await screen.findByTestId("login-signup-email"), {
      target: { value: "invalid-email" }
    });
    fireEvent.change(screen.getByTestId("login-signup-password"), {
      target: { value: "short" }
    });
    fireEvent.click(screen.getByTestId("login-signup-submit"));

    expect(await screen.findByTestId("login-signup-name-error")).toHaveTextContent(
      "Enter your name."
    );
    expect(screen.getByTestId("login-signup-email-error")).toHaveTextContent(
      "Enter a valid email address."
    );
    expect(screen.getByTestId("login-signup-password-error")).toHaveTextContent(
      "Use at least 8 characters."
    );
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("login-signin-email-error")).not.toBeInTheDocument();
  });
});
