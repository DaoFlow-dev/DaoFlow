// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { GitLabProviderDialog } from "./GitLabProviderDialog";
import {
  buildGitLabProviderPayload,
  INITIAL_GITLAB_PROVIDER_FORM,
  isGitLabProviderFormValid,
  type GitLabProviderFormState
} from "./gitlab-provider-form";

const {
  registerGitProviderUseMutationMock,
  registerGitProviderMutateMock,
  registerGitProviderResetMock
} = vi.hoisted(() => ({
  registerGitProviderUseMutationMock: vi.fn(),
  registerGitProviderMutateMock: vi.fn(),
  registerGitProviderResetMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    registerGitProvider: {
      useMutation: registerGitProviderUseMutationMock
    }
  }
}));

let mutationOptions: { onSuccess?: () => void } = {};

function DialogHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="reopen-gitlab-dialog">
        Reopen
      </button>
      <GitLabProviderDialog open={open} onOpenChange={setOpen} onRegistered={vi.fn()} />
    </>
  );
}

function formWith(overrides: Partial<GitLabProviderFormState>): GitLabProviderFormState {
  return { ...INITIAL_GITLAB_PROVIDER_FORM, name: "Self-hosted GitLab", ...overrides };
}

describe("GitLab provider credentials", () => {
  beforeEach(() => {
    mutationOptions = {};
    registerGitProviderMutateMock.mockReset();
    registerGitProviderResetMock.mockReset();
    registerGitProviderUseMutationMock.mockImplementation((options: typeof mutationOptions) => {
      mutationOptions = options;
      return {
        error: null,
        isPending: false,
        mutate: registerGitProviderMutateMock,
        reset: registerGitProviderResetMock
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("builds the OAuth payload with common routing fields", () => {
    expect(
      buildGitLabProviderPayload(
        formWith({
          clientId: "client-id",
          clientSecret: "client-secret",
          webhookSecret: "webhook-secret",
          baseUrl: "https://gitlab.example.com",
          internalBaseUrl: "https://gitlab.internal.example.com"
        })
      )
    ).toEqual({
      type: "gitlab",
      name: "Self-hosted GitLab",
      clientId: "client-id",
      clientSecret: "client-secret",
      webhookSecret: "webhook-secret",
      baseUrl: "https://gitlab.example.com",
      internalBaseUrl: "https://gitlab.internal.example.com",
      gitlabCredential: { kind: "oauth" }
    });
  });

  it("builds API-token and deploy-token payloads with ISO expiry values", () => {
    expect(
      buildGitLabProviderPayload(
        formWith({
          credentialMode: "api_token",
          apiToken: "api-token",
          expiresAt: "2030-01-02"
        })
      )
    ).toEqual({
      type: "gitlab",
      name: "Self-hosted GitLab",
      clientId: undefined,
      clientSecret: undefined,
      webhookSecret: undefined,
      baseUrl: undefined,
      internalBaseUrl: undefined,
      gitlabCredential: {
        kind: "api_token",
        token: "api-token",
        expiresAt: "2030-01-02T00:00:00.000Z"
      }
    });

    expect(
      buildGitLabProviderPayload(
        formWith({
          credentialMode: "deploy_token",
          deployUsername: "gitlab+deploy-token-1",
          deployToken: "deploy-token",
          expiresAt: "2030-02-03"
        })
      )
    ).toMatchObject({
      gitlabCredential: {
        kind: "deploy_token",
        username: "gitlab+deploy-token-1",
        token: "deploy-token",
        expiresAt: "2030-02-03T00:00:00.000Z"
      }
    });
  });

  it("requires only the fields for the selected credential mode", () => {
    expect(isGitLabProviderFormValid(formWith({}))).toBe(false);
    expect(isGitLabProviderFormValid(formWith({ credentialMode: "oauth", clientId: "id" }))).toBe(
      false
    );
    expect(
      isGitLabProviderFormValid(formWith({ credentialMode: "api_token", apiToken: "api-token" }))
    ).toBe(true);
    expect(
      isGitLabProviderFormValid(
        formWith({ credentialMode: "deploy_token", deployUsername: "username" })
      )
    ).toBe(false);
    expect(
      isGitLabProviderFormValid(
        formWith({
          credentialMode: "deploy_token",
          deployUsername: "username",
          deployToken: "token"
        })
      )
    ).toBe(true);
  });

  it("clears secrets after closing and after successful registration", () => {
    render(<DialogHarness />);

    fireEvent.change(screen.getByTestId("git-provider-name-input"), {
      target: { value: "GitLab" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-id-input"), {
      target: { value: "client-id" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-secret-input"), {
      target: { value: "client-secret" }
    });
    fireEvent.change(screen.getByTestId("git-provider-webhook-secret-input"), {
      target: { value: "webhook-secret" }
    });
    fireEvent.click(screen.getByTestId("git-provider-cancel-button"));
    fireEvent.click(screen.getByTestId("reopen-gitlab-dialog"));

    expect(screen.getByTestId("git-provider-name-input")).toHaveValue("");
    expect(screen.getByTestId("git-provider-client-secret-input")).toHaveValue("");
    expect(screen.getByTestId("git-provider-webhook-secret-input")).toHaveValue("");

    fireEvent.change(screen.getByTestId("git-provider-name-input"), {
      target: { value: "GitLab" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-id-input"), {
      target: { value: "client-id" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-secret-input"), {
      target: { value: "client-secret" }
    });
    fireEvent.click(screen.getByTestId("git-provider-register-button"));
    expect(registerGitProviderMutateMock).toHaveBeenCalled();

    mutationOptions.onSuccess?.();
    fireEvent.click(screen.getByTestId("reopen-gitlab-dialog"));
    expect(screen.getByTestId("git-provider-client-secret-input")).toHaveValue("");
    expect(screen.queryByText("client-secret")).not.toBeInTheDocument();
  });

  it("shows a safe registration error returned by the server", () => {
    registerGitProviderUseMutationMock.mockReturnValue({
      error: new Error("GitLab API token could not be validated."),
      isPending: false,
      mutate: registerGitProviderMutateMock,
      reset: registerGitProviderResetMock
    });

    render(<DialogHarness />);

    expect(screen.getByTestId("git-provider-registration-error")).toHaveTextContent(
      "GitLab API token could not be validated."
    );
  });
});
