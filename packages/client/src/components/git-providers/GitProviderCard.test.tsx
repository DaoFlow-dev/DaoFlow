// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitProviderCard } from "./GitProviderCard";

const { deleteGitProviderUseMutationMock, startGitProviderSetupUseMutationMock } = vi.hoisted(
  () => ({
    deleteGitProviderUseMutationMock: vi.fn(),
    startGitProviderSetupUseMutationMock: vi.fn()
  })
);

vi.mock("../../lib/trpc", () => ({
  trpc: {
    deleteGitProvider: { useMutation: deleteGitProviderUseMutationMock },
    startGitProviderSetup: { useMutation: startGitProviderSetupUseMutationMock }
  }
}));

describe("GitProviderCard", () => {
  beforeEach(() => {
    deleteGitProviderUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    startGitProviderSetupUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
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
        onDeleted={vi.fn()}
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
});
