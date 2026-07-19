import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGitProviderCaForProvider } from "../db/services/git-provider-ca-trust";
import { resolveProviderCaCheckoutContext } from "./git-provider-checkout-context";

vi.mock("../db/services/git-provider-ca-trust", () => ({
  resolveGitProviderCaForProvider: vi.fn()
}));

const resolveCa = vi.mocked(resolveGitProviderCaForProvider);

afterEach(() => {
  vi.resetAllMocks();
});

describe("resolveProviderCaCheckoutContext", () => {
  it("keeps the public-provider checkout context unchanged", async () => {
    resolveCa.mockResolvedValue(null);

    await expect(
      resolveProviderCaCheckoutContext(
        { teamId: "team_public", caCertificateId: null },
        "https://github.com/example/repository.git"
      )
    ).resolves.toEqual({});
    expect(resolveCa).toHaveBeenCalledWith({ teamId: "team_public", caCertificateId: null });
  });

  it("carries only the resolved PEM to an HTTPS checkout", async () => {
    resolveCa.mockResolvedValue({
      certificateId: "cert_provider_ca",
      name: "Git provider root",
      fingerprint: "sha256:fixture",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      pem: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----"
    });

    await expect(
      resolveProviderCaCheckoutContext(
        { teamId: "team_private", caCertificateId: "cert_provider_ca" },
        "https://git.example.test/team/repository.git"
      )
    ).resolves.toEqual({
      caCertificatePem: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----"
    });
  });

  it("fails closed when a selected CA would be used with a non-HTTPS URL", async () => {
    resolveCa.mockResolvedValue({
      certificateId: "cert_provider_ca",
      name: "Git provider root",
      fingerprint: "sha256:fixture",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      pem: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----"
    });

    await expect(
      resolveProviderCaCheckoutContext(
        { teamId: "team_private", caCertificateId: "cert_provider_ca" },
        "git@git.example.test:team/repository.git"
      )
    ).rejects.toThrow("only be used with an HTTPS repository URL");
  });
});
