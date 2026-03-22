// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GitProvidersTab from "./GitProvidersTab";

const {
  gitProvidersUseQueryMock,
  registerGitProviderUseMutationMock,
  deleteGitProviderUseMutationMock
} = vi.hoisted(() => ({
  gitProvidersUseQueryMock: vi.fn(),
  registerGitProviderUseMutationMock: vi.fn(),
  deleteGitProviderUseMutationMock: vi.fn()
}));

const { registerGitProviderMutateMock, refetchMock } = vi.hoisted(() => ({
  registerGitProviderMutateMock: vi.fn(),
  refetchMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    gitProviders: {
      useQuery: gitProvidersUseQueryMock
    },
    registerGitProvider: {
      useMutation: registerGitProviderUseMutationMock
    },
    deleteGitProvider: {
      useMutation: deleteGitProviderUseMutationMock
    }
  }
}));

describe("GitProvidersTab", () => {
  beforeEach(() => {
    refetchMock.mockReset();
    registerGitProviderMutateMock.mockReset();
    gitProvidersUseQueryMock.mockReturnValue({
      data: [],
      refetch: refetchMock
    });
    registerGitProviderUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: registerGitProviderMutateMock
    });
    deleteGitProviderUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("submits the GitHub provider payload with the required private key", () => {
    render(<GitProvidersTab />);

    fireEvent.click(screen.getByTestId("git-provider-add-button"));

    fireEvent.change(screen.getByTestId("git-provider-name-input"), {
      target: { value: "My GitHub App" }
    });
    fireEvent.change(screen.getByTestId("git-provider-app-id-input"), {
      target: { value: "123456" }
    });
    fireEvent.change(screen.getByTestId("git-provider-private-key-input"), {
      target: { value: "-----BEGIN RSA PRIVATE KEY-----\nkey-material" }
    });
    fireEvent.change(screen.getByTestId("git-provider-webhook-secret-input"), {
      target: { value: "github-webhook-secret" }
    });
    fireEvent.click(screen.getByTestId("git-provider-register-button"));

    expect(registerGitProviderMutateMock).toHaveBeenCalledWith({
      type: "github",
      name: "My GitHub App",
      appId: "123456",
      clientId: undefined,
      clientSecret: undefined,
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\nkey-material",
      webhookSecret: "github-webhook-secret",
      baseUrl: undefined
    });
  });

  it("submits the GitLab provider payload with the required client secret", () => {
    render(<GitProvidersTab />);

    fireEvent.click(screen.getByTestId("git-provider-add-button"));
    fireEvent.click(screen.getByTestId("git-provider-type-gitlab"));

    fireEvent.change(screen.getByTestId("git-provider-name-input"), {
      target: { value: "My GitLab App" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-id-input"), {
      target: { value: "gitlab-client-id" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-secret-input"), {
      target: { value: "gitlab-client-secret" }
    });
    fireEvent.change(screen.getByTestId("git-provider-webhook-secret-input"), {
      target: { value: "gitlab-webhook-secret" }
    });
    fireEvent.change(screen.getByTestId("git-provider-base-url-input"), {
      target: { value: "https://gitlab.example.com" }
    });
    fireEvent.click(screen.getByTestId("git-provider-register-button"));

    expect(registerGitProviderMutateMock).toHaveBeenCalledWith({
      type: "gitlab",
      name: "My GitLab App",
      appId: undefined,
      clientId: "gitlab-client-id",
      clientSecret: "gitlab-client-secret",
      privateKey: undefined,
      webhookSecret: "gitlab-webhook-secret",
      baseUrl: "https://gitlab.example.com"
    });
  });

  it("normalizes the GitHub install href from the provider display name", () => {
    gitProvidersUseQueryMock.mockReturnValue({
      data: [
        {
          id: "provider_github",
          type: "github",
          name: "My App N ame",
          status: "active",
          appId: "123456",
          clientId: null,
          baseUrl: null
        }
      ],
      refetch: refetchMock
    });

    render(<GitProvidersTab />);

    const installButton = screen.getByTestId("git-provider-install-provider_github");
    const installLink = installButton.closest("a");

    expect(installLink).toHaveAttribute(
      "href",
      "https://github.com/apps/my-app-n-ame/installations/new?state=provider_github"
    );
  });

  it("suppresses the GitHub install action when the normalized app slug is empty", () => {
    gitProvidersUseQueryMock.mockReturnValue({
      data: [
        {
          id: "provider_github_empty_slug",
          type: "github",
          name: "!!!",
          status: "active",
          appId: "123456",
          clientId: null,
          baseUrl: null
        }
      ],
      refetch: refetchMock
    });

    render(<GitProvidersTab />);

    expect(screen.queryByTestId("git-provider-install-provider_github_empty_slug")).toBeNull();
  });
});
