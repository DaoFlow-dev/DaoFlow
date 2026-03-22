// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GitCallbackPage from "./GitCallbackPage";

type GitInstallationSuccessData = { accountName: string } | { summary: { accountName: string } };

const { createGitInstallationUseMutationMock, exchangeGitLabCodeUseMutationMock, navigateMock } =
  vi.hoisted(() => ({
    createGitInstallationUseMutationMock: vi.fn(),
    exchangeGitLabCodeUseMutationMock: vi.fn(),
    navigateMock: vi.fn()
  }));

const { createGitInstallationMutateMock, exchangeGitLabCodeMutateMock } = vi.hoisted(() => ({
  createGitInstallationMutateMock: vi.fn(),
  exchangeGitLabCodeMutateMock: vi.fn()
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
    createGitInstallation: {
      useMutation: createGitInstallationUseMutationMock
    },
    exchangeGitLabCode: {
      useMutation: exchangeGitLabCodeUseMutationMock
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
    createGitInstallationMutateMock.mockReset();
    exchangeGitLabCodeMutateMock.mockReset();
    createGitInstallationUseMutationMock.mockImplementation(
      ({ onSuccess }: { onSuccess?: (data: GitInstallationSuccessData) => void }) => ({
        isPending: false,
        mutate: createGitInstallationMutateMock.mockImplementation(
          (input: { accountName: string }) => {
            onSuccess?.({ accountName: input.accountName });
          }
        )
      })
    );
    exchangeGitLabCodeUseMutationMock.mockImplementation(
      ({ onSuccess }: { onSuccess?: (data: GitInstallationSuccessData) => void }) => ({
        isPending: false,
        mutate: exchangeGitLabCodeMutateMock.mockImplementation(() => {
          onSuccess?.({ summary: { accountName: "gitlab-octo" } });
        })
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the GitHub App callback success state and account detail", async () => {
    renderGitCallbackPage(
      "/settings/git/callback?installation_id=42&setup_action=install&provider_id=provider_github&account=octo-org&target_type=organization"
    );

    await waitFor(() => {
      expect(createGitInstallationMutateMock).toHaveBeenCalledWith({
        providerId: "provider_github",
        installationId: "42",
        accountName: "octo-org",
        accountType: "organization"
      });
    });
    expect(await screen.findByText("Installation connected successfully")).toBeVisible();
    expect(screen.getByText("Account: octo-org")).toBeVisible();
    expect(screen.getByRole("button", { name: "Go to Projects" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Go to Projects" }));
    expect(navigateMock).toHaveBeenCalledWith("/projects");
  });

  it("renders the GitLab OAuth callback success state for wrapped payloads", async () => {
    renderGitCallbackPage("/settings/git/callback?code=oauth-code&state=provider_gitlab");

    await waitFor(() => {
      expect(exchangeGitLabCodeMutateMock).toHaveBeenCalledWith({
        code: "oauth-code",
        providerId: "provider_gitlab"
      });
    });
    expect(await screen.findByText("GitLab connected successfully")).toBeVisible();
    expect(screen.getByText("Account: gitlab-octo")).toBeVisible();
  });

  it("renders a cancelled installation state when setup_action is not install or update", async () => {
    renderGitCallbackPage(
      "/settings/git/callback?installation_id=42&setup_action=cancel&provider_id=provider_github"
    );

    await waitFor(() => {
      expect(screen.getByText("Installation was cancelled")).toBeVisible();
    });
    expect(screen.getByText("The GitHub App installation was not completed.")).toBeVisible();
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
