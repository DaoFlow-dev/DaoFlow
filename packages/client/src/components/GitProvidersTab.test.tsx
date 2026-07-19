// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { clickSelectOption } from "@/test/select-option";
import GitProvidersTab from "./GitProvidersTab";

const {
  gitProvidersUseQueryMock,
  gitInstallationsUseQueryMock,
  certificateAssetsUseQueryMock,
  webhookDeliveriesUseQueryMock,
  registerGitProviderUseMutationMock,
  deleteGitProviderUseMutationMock,
  updateGitProviderCaUseMutationMock,
  startGitHubAppManifestSetupUseMutationMock,
  startGitProviderSetupUseMutationMock
} = vi.hoisted(() => ({
  gitProvidersUseQueryMock: vi.fn(),
  gitInstallationsUseQueryMock: vi.fn(),
  certificateAssetsUseQueryMock: vi.fn(),
  webhookDeliveriesUseQueryMock: vi.fn(),
  registerGitProviderUseMutationMock: vi.fn(),
  deleteGitProviderUseMutationMock: vi.fn(),
  updateGitProviderCaUseMutationMock: vi.fn(),
  startGitHubAppManifestSetupUseMutationMock: vi.fn(),
  startGitProviderSetupUseMutationMock: vi.fn()
}));

const { registerGitProviderMutateMock, startGitProviderSetupMutateMock, refetchMock } = vi.hoisted(
  () => ({
    registerGitProviderMutateMock: vi.fn(),
    startGitProviderSetupMutateMock: vi.fn(),
    refetchMock: vi.fn()
  })
);

vi.mock("@/lib/trpc", () => ({
  trpc: {
    gitProviders: {
      useQuery: gitProvidersUseQueryMock
    },
    gitInstallations: {
      useQuery: gitInstallationsUseQueryMock
    },
    certificateAssets: {
      useQuery: certificateAssetsUseQueryMock
    },
    webhookDeliveries: {
      useQuery: webhookDeliveriesUseQueryMock
    },
    registerGitProvider: {
      useMutation: registerGitProviderUseMutationMock
    },
    deleteGitProvider: {
      useMutation: deleteGitProviderUseMutationMock
    },
    updateGitProviderCa: {
      useMutation: updateGitProviderCaUseMutationMock
    },
    startGitHubAppManifestSetup: {
      useMutation: startGitHubAppManifestSetupUseMutationMock
    },
    startGitProviderSetup: {
      useMutation: startGitProviderSetupUseMutationMock
    }
  }
}));

function renderWithRouter(ui: React.ReactElement, initialEntry = "/settings") {
  return render(<MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>);
}

describe("GitProvidersTab", () => {
  beforeEach(() => {
    refetchMock.mockReset();
    registerGitProviderMutateMock.mockReset();
    gitProvidersUseQueryMock.mockReturnValue({
      data: [],
      refetch: refetchMock
    });
    gitInstallationsUseQueryMock.mockReturnValue({
      data: [],
      refetch: refetchMock
    });
    certificateAssetsUseQueryMock.mockReturnValue({ data: [] });
    webhookDeliveriesUseQueryMock.mockReturnValue({ data: [] });
    registerGitProviderUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: registerGitProviderMutateMock
    });
    deleteGitProviderUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn()
    });
    updateGitProviderCaUseMutationMock.mockReturnValue({
      error: null,
      isPending: false,
      mutate: vi.fn()
    });
    startGitHubAppManifestSetupUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn()
    });
    startGitProviderSetupMutateMock.mockReset();
    startGitProviderSetupUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: startGitProviderSetupMutateMock
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("submits the GitHub provider payload via the manual form", () => {
    renderWithRouter(<GitProvidersTab />);

    fireEvent.click(screen.getByTestId("git-provider-add-github"));
    fireEvent.click(screen.getByTestId("github-manual-link"));

    fireEvent.change(screen.getByTestId("git-provider-name-input"), {
      target: { value: "My GitHub App" }
    });
    fireEvent.change(screen.getByTestId("git-provider-app-id-input"), {
      target: { value: "123456" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-id-input"), {
      target: { value: "Iv1.github-client" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-secret-input"), {
      target: { value: "github-client-secret" }
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
      clientId: "Iv1.github-client",
      clientSecret: "github-client-secret",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\nkey-material",
      webhookSecret: "github-webhook-secret",
      baseUrl: undefined
    });
  });

  it("includes a selected CA certificate in manual GitHub registration", () => {
    certificateAssetsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "certificate_github",
          name: "GitHub Enterprise CA",
          fingerprint: "sha256:github",
          expiresAt: "2030-01-01T00:00:00.000Z",
          status: "active"
        }
      ]
    });

    renderWithRouter(<GitProvidersTab />);

    fireEvent.click(screen.getByTestId("git-provider-add-github"));
    fireEvent.click(screen.getByTestId("github-manual-link"));
    fireEvent.change(screen.getByTestId("git-provider-name-input"), {
      target: { value: "My GitHub App" }
    });
    fireEvent.change(screen.getByTestId("git-provider-app-id-input"), {
      target: { value: "123456" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-id-input"), {
      target: { value: "Iv1.github-client" }
    });
    fireEvent.change(screen.getByTestId("git-provider-client-secret-input"), {
      target: { value: "github-client-secret" }
    });
    fireEvent.change(screen.getByTestId("git-provider-private-key-input"), {
      target: { value: "private-key" }
    });
    fireEvent.click(screen.getByTestId("git-provider-ca-select"));
    clickSelectOption("GitHub Enterprise CA · active");
    fireEvent.click(screen.getByTestId("git-provider-register-button"));

    expect(registerGitProviderMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ caCertificateId: "certificate_github" })
    );
  });

  it("submits the GitLab provider payload with the required client secret", () => {
    renderWithRouter(<GitProvidersTab />);

    fireEvent.click(screen.getByTestId("git-provider-add-gitlab"));

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
      clientId: "gitlab-client-id",
      clientSecret: "gitlab-client-secret",
      webhookSecret: "gitlab-webhook-secret",
      baseUrl: "https://gitlab.example.com",
      internalBaseUrl: undefined,
      gitlabCredential: { kind: "oauth" }
    });
  });

  it("starts a server-bound GitHub installation flow", () => {
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

    renderWithRouter(<GitProvidersTab />);

    const installButton = screen.getByTestId("git-provider-install-provider_github");
    fireEvent.click(installButton);

    expect(startGitProviderSetupMutateMock).toHaveBeenCalledWith({
      providerId: "provider_github"
    });
  });

  it("shows recent webhook attempt and target status", () => {
    webhookDeliveriesUseQueryMock.mockReturnValue({
      data: [
        {
          id: "delivery_1",
          providerType: "github",
          repoFullName: "example/production-app",
          commitSha: "abcdef1234567890",
          status: "partial",
          attemptCount: 2,
          lastErrorSummary: "One deployment target remains incomplete.",
          lastSeenAt: new Date("2026-07-19T00:00:00.000Z"),
          attempts: [
            {
              id: "attempt_2",
              attemptNumber: 2,
              status: "partial",
              errorSummary: "One deployment target remains incomplete."
            },
            {
              id: "attempt_1",
              attemptNumber: 1,
              status: "expired",
              errorSummary: "The processing lease expired."
            }
          ],
          targets: [
            {
              targetKey: "service:svc_api",
              status: "completed",
              errorSummary: null
            },
            {
              targetKey: "service:svc_worker",
              status: "failed",
              errorSummary: "Provider validation is unavailable."
            }
          ]
        }
      ]
    });

    renderWithRouter(<GitProvidersTab />);

    expect(screen.getByText("example/production-app")).toBeInTheDocument();
    expect(screen.getByText("2 attempt(s)")).toBeInTheDocument();
    expect(screen.getByText("attempt #2 · partial")).toBeInTheDocument();
    expect(screen.getByText("attempt #1 · expired")).toBeInTheDocument();
    expect(screen.getByText("svc_api · completed")).toBeInTheDocument();
    expect(screen.getByText("svc_worker · failed")).toBeInTheDocument();
  });

  it("starts GitHub setup without deriving an app slug from the display name", () => {
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

    renderWithRouter(<GitProvidersTab />);

    fireEvent.click(screen.getByTestId("git-provider-install-provider_github_empty_slug"));

    expect(startGitProviderSetupMutateMock).toHaveBeenCalledWith({
      providerId: "provider_github_empty_slug"
    });
  });

  it("starts a server-bound GitLab OAuth flow", () => {
    gitProvidersUseQueryMock.mockReturnValue({
      data: [
        {
          id: "provider_gitlab",
          type: "gitlab",
          name: "Self-Hosted GitLab",
          status: "active",
          appId: null,
          clientId: "gitlab-client-id",
          baseUrl: "https://gitlab.example.com/"
        }
      ],
      refetch: refetchMock
    });

    renderWithRouter(<GitProvidersTab />);

    const connectButton = screen.getByTestId("git-provider-connect-provider_gitlab");
    fireEvent.click(connectButton);

    expect(startGitProviderSetupMutateMock).toHaveBeenCalledWith({
      providerId: "provider_gitlab"
    });
  });

  it("shows the one-click GitHub manifest dialog with organization toggle", () => {
    renderWithRouter(<GitProvidersTab />);

    fireEvent.click(screen.getByTestId("git-provider-add-github"));

    expect(screen.getByTestId("github-create-app-button")).toBeInTheDocument();
    expect(screen.getByTestId("github-org-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("github-manual-link")).toBeInTheDocument();
    const manifestInput = document.querySelector<HTMLInputElement>('input[name="manifest"]');
    expect(manifestInput).not.toBeNull();
    expect(JSON.parse(manifestInput?.value ?? "{}")).toMatchObject({
      callback_urls: ["http://localhost:3000/api/github/setup"],
      redirect_url: "http://localhost:3000/api/github/setup",
      request_oauth_on_install: true
    });
  });
});
