// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GitCallbackPage from "./GitCallbackPage";

type GitInstallationSuccessData = { accountName: string } | { summary: { accountName: string } };

const { completeGitLabOAuthSetupUseMutationMock, navigateMock } = vi.hoisted(() => ({
  completeGitLabOAuthSetupUseMutationMock: vi.fn(),
  navigateMock: vi.fn()
}));

const { completeGitLabOAuthSetupMutateMock } = vi.hoisted(() => ({
  completeGitLabOAuthSetupMutateMock: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("../lib/trpc", () => ({
  trpc: {
    completeGitLabOAuthSetup: {
      useMutation: completeGitLabOAuthSetupUseMutationMock
    }
  }
}));

describe("GitCallbackPage", () => {
  function renderGitCallbackPage(initialEntry: string) {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <GitCallbackPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    navigateMock.mockReset();
    completeGitLabOAuthSetupMutateMock.mockReset();
    completeGitLabOAuthSetupUseMutationMock.mockImplementation(
      ({ onSuccess }: { onSuccess?: (data: GitInstallationSuccessData) => void }) => ({
        isPending: false,
        mutate: completeGitLabOAuthSetupMutateMock.mockImplementation(() => {
          onSuccess?.({ summary: { accountName: "gitlab-octo" } });
        })
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the GitLab OAuth callback success state and account detail", async () => {
    renderGitCallbackPage("/settings/git/callback?code=oauth-code&state=opaque-state");

    await waitFor(() => {
      expect(completeGitLabOAuthSetupMutateMock).toHaveBeenCalledWith({
        code: "oauth-code",
        state: "opaque-state"
      });
    });
    expect(await screen.findByText("GitLab connected successfully")).toBeVisible();
    expect(screen.getByText("Account: gitlab-octo")).toBeVisible();
    expect(screen.getByRole("button", { name: "Go to Projects" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Go to Projects" }));
    expect(navigateMock).toHaveBeenCalledWith("/projects");
  });

  it("passes only the code and opaque state to the callback mutation", async () => {
    renderGitCallbackPage("/settings/git/callback?code=second-code&state=second-opaque-state");

    await waitFor(() => {
      expect(completeGitLabOAuthSetupMutateMock).toHaveBeenCalledWith({
        code: "second-code",
        state: "second-opaque-state"
      });
    });
    expect(await screen.findByText("GitLab connected successfully")).toBeVisible();
    expect(screen.getByText("Account: gitlab-octo")).toBeVisible();
  });

  it("rejects legacy GitHub callback parameters on the client route", async () => {
    renderGitCallbackPage(
      "/settings/git/callback?installation_id=42&setup_action=cancel&provider_id=provider_github"
    );

    await waitFor(() => {
      expect(screen.getByText("Invalid callback")).toBeVisible();
    });
    expect(
      screen.getByText(
        "Missing required parameters. Please try the installation again from Settings."
      )
    ).toBeVisible();
  });

  it("renders an invalid callback state when required params are missing", async () => {
    renderGitCallbackPage("/settings/git/callback");

    await waitFor(() => {
      expect(screen.getByText("Invalid callback")).toBeVisible();
    });
    expect(
      screen.getByText(
        "Missing required parameters. Please try the installation again from Settings."
      )
    ).toBeVisible();
  });
});
