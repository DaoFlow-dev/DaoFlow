// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clickSelectOption } from "@/test/select-option";
import { GitProviderCard } from "./GitProviderCard";

const {
  deleteGitProviderUseMutationMock,
  startGitProviderSetupUseMutationMock,
  updateGitProviderCaUseMutationMock,
  updateGitProviderCaMutateMock
} = vi.hoisted(() => ({
  deleteGitProviderUseMutationMock: vi.fn(),
  startGitProviderSetupUseMutationMock: vi.fn(),
  updateGitProviderCaUseMutationMock: vi.fn(),
  updateGitProviderCaMutateMock: vi.fn()
}));

vi.mock("../../lib/trpc", () => ({
  trpc: {
    deleteGitProvider: { useMutation: deleteGitProviderUseMutationMock },
    startGitProviderSetup: { useMutation: startGitProviderSetupUseMutationMock },
    updateGitProviderCa: { useMutation: updateGitProviderCaUseMutationMock }
  }
}));

describe("GitProviderCard", () => {
  beforeEach(() => {
    deleteGitProviderUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    startGitProviderSetupUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    updateGitProviderCaMutateMock.mockReset();
    updateGitProviderCaUseMutationMock.mockReturnValue({
      error: null,
      isPending: false,
      mutate: updateGitProviderCaMutateMock
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows deploy-token capabilities and hides the OAuth connect action", () => {
    render(
      <GitProviderCard
        provider={{
          id: "provider_gitlab_deploy",
          type: "gitlab",
          name: "Self-Hosted GitLab",
          status: "active",
          appId: null,
          clientId: "gitlab-client-id",
          baseUrl: "https://gitlab.example.com",
          internalBaseUrl: "https://gitlab.internal.example.com"
        }}
        installations={[
          {
            id: "installation_deploy",
            providerId: "provider_gitlab_deploy",
            accountName: "platform/team",
            credentialKind: "deploy_token",
            credentialScopes: ["read_repository"],
            credentialExpiresAt: "2030-01-01T00:00:00.000Z",
            capabilities: { clone: true, api: false, feedback: false }
          }
        ]}
        certificateAssets={[]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByTestId("git-provider-credential-installation_deploy")).toHaveTextContent(
      "Credential: Deploy token"
    );
    expect(screen.getByTestId("git-provider-scopes-installation_deploy")).toHaveTextContent(
      "read_repository"
    );
    expect(
      screen.getByTestId("git-provider-capability-installation_deploy-clone")
    ).toHaveTextContent("Clone: Yes");
    expect(screen.getByTestId("git-provider-capability-installation_deploy-api")).toHaveTextContent(
      "API: No"
    );
    expect(
      screen.getByTestId("git-provider-capability-installation_deploy-feedback")
    ).toHaveTextContent("Feedback: No");
    expect(screen.getByTestId("git-provider-clone-only-installation_deploy")).toHaveTextContent(
      "Clone only"
    );
    expect(
      screen.queryByTestId("git-provider-connect-provider_gitlab_deploy")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("git-provider-internal-route-provider_gitlab_deploy")
    ).toHaveTextContent("https://gitlab.internal.example.com");
  });

  it("shows the selected CA fingerprint and warns when expiry is near", () => {
    vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));

    render(
      <GitProviderCard
        provider={{
          id: "provider_github_ca",
          type: "github",
          name: "GitHub Enterprise",
          status: "active",
          appId: "123456",
          clientId: null,
          baseUrl: "https://github.example.com",
          caCertificateId: "certificate_ca"
        }}
        installations={[]}
        certificateAssets={[
          {
            id: "certificate_ca",
            name: "Enterprise CA",
            fingerprint: "sha256:abc123",
            expiresAt: "2026-08-01T00:00:00.000Z",
            status: "active"
          }
        ]}
        onChanged={vi.fn()}
      />
    );

    expect(
      screen.getByTestId("git-provider-ca-details-provider_github_ca-fingerprint")
    ).toHaveTextContent("sha256:abc123");
    expect(screen.getByTestId("git-provider-ca-details-provider_github_ca-expiry")).toHaveAttribute(
      "data-expiry-state",
      "soon"
    );
    expect(
      screen.getByTestId("git-provider-ca-details-provider_github_ca-expiry")
    ).toHaveTextContent("within 30 days");

    fireEvent.click(screen.getByTestId("git-provider-ca-select-provider_github_ca"));
    clickSelectOption("None (use public CA trust)");

    expect(updateGitProviderCaMutateMock).toHaveBeenCalledWith({
      providerId: "provider_github_ca",
      caCertificateId: null
    });
    vi.useRealTimers();
  });
});
