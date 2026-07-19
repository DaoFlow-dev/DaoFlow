import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { resetSeededTestDatabase } from "./test-db";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { auditEntries } from "./db/schema/audit";
import { certificateAssets } from "./db/schema/access-assets";
import { gitProviders } from "./db/schema/git-providers";
import { teams } from "./db/schema/teams";
import { makeSession } from "./testing/request-auth-fixtures";

const testCaPem = `-----BEGIN CERTIFICATE-----
MIIDKDCCAhCgAwIBAgIUbEEyVxaJV+y6cqx3kbrqXz+vAm4wDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPRGFvRmxvdyBUZXN0IENBMB4XDTI2MDcxOTEwNDQyM1oX
DTM2MDcxNjEwNDQyM1owGjEYMBYGA1UEAwwPRGFvRmxvdyBUZXN0IENBMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2YSP+3SgkyUWl4jZUHoUsOfcq2My
VTNW+qZbzP2HXfU1D8gKEV1CWAcMaNxpnMKddUq8NL1Vkvx3qP+ll8aAnXglaPAe
LIH9xuT609wOhLBAwQGHeeTLwF2kh/Hk57xmYqhulSiky9DwJAZEyw81yDQgC4AI
pQwLot5r3nPs7mwNnKQfejka8P4nPi+5jXHNbrI7SNtwdUARbLZCova5m1K9Zp8m
c2w/tgOD8pCqXA3UHvzLheEHQdiAuXPppjWfRGYNsHiGHqGVZ1mam4wV0kZzj2ho
rRzqhVRWsvjZ7PeTzNlS/2aNKoajWy35PSp+gqzgSxqELAhn+Kc5QBnZuQIDAQAB
o2YwZDAdBgNVHQ4EFgQUFlBC7jXagKT3lHrUOW57TD9/5AQwHwYDVR0jBBgwFoAU
FlBC7jXagKT3lHrUOW57TD9/5AQwEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8B
Af8EBAMCAQYwDQYJKoZIhvcNAQELBQADggEBAIsKJ3eALktMMYov5K+gzI8Qap9g
4Ey6dCuCsEsb4XLQlxMMzXv2q47GdE1HwYatoxY6NOA2KkDl6yQ4Oa3NTcFWOhwL
uK+CrEe9QunB2xd0dDkgezlJJ67s3D3Pw7fWIGRHafq7Xjj8jH+VNniIK9b1hEWM
kAF/UMyYJ2StFrcwpYusbSKrZ2TqKvL48tdnUUmU0+bREiLqPT+FhUvOPDYRPcKX
E7rodRI3iGLfWudxXvO8pm3BWr7sKsLihMQP9A355mF7E50GIRmdWV5ZnsO30Qrq
3H4exkdJVufhQoxTVxsZs3IjX4bxxt+Ob1zWFuaTUxfhY6WnaH2Cd5VRzZ8=
-----END CERTIFICATE-----`;

function caller() {
  return appRouter.createCaller({
    requestId: "test-git-provider-ca-contract",
    session: makeSession("admin")
  });
}

async function createCertificate(id: string, fingerprint: string, teamId = "team_foundation") {
  await db.insert(certificateAssets).values({
    id,
    teamId,
    name: id,
    certificatePemEncrypted: encrypt(testCaPem),
    fingerprint,
    status: "active",
    updatedAt: new Date()
  });
}

describe("git provider CA admin contract", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
    vi.restoreAllMocks();
  });

  it("registers, updates, clears, and audits a selected team CA without exposing its PEM", async () => {
    await createCertificate("cert_provider_ca_a", "sha256:provider-ca-a");
    await createCertificate("cert_provider_ca_b", "sha256:provider-ca-b");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 247, username: "ca-token-user" }), { status: 200 })
      );

    const registered = await caller().registerGitProvider({
      type: "gitlab",
      name: "CA-backed GitLab",
      baseUrl: "https://gitlab.example.test",
      caCertificateId: "cert_provider_ca_a",
      gitlabCredential: { kind: "api_token", token: "glpat-ca-token" }
    });
    expect(registered).toMatchObject({ caCertificateId: "cert_provider_ca_a" });
    expect(JSON.stringify(registered)).not.toContain(testCaPem);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.example.test/api/v4/user",
      expect.objectContaining({ tls: { ca: testCaPem } })
    );
    await expect(
      db.delete(certificateAssets).where(eq(certificateAssets.id, "cert_provider_ca_a"))
    ).rejects.toThrow();

    const changed = await caller().updateGitProviderCa({
      providerId: registered.id,
      caCertificateId: "cert_provider_ca_b"
    });
    expect(changed.caCertificateId).toBe("cert_provider_ca_b");

    const cleared = await caller().updateGitProviderCa({
      providerId: registered.id,
      caCertificateId: null
    });
    expect(cleared.caCertificateId).toBeNull();
    const [stored] = await db.select().from(gitProviders).where(eq(gitProviders.id, registered.id));
    expect(stored?.caCertificateId).toBeNull();

    const summaries = await caller().gitProviders();
    expect(summaries).toEqual([
      expect.objectContaining({ id: registered.id, caCertificateId: null })
    ]);
    expect(JSON.stringify(summaries)).not.toContain(testCaPem);

    const audits = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `git_provider/${registered.id}`));
    expect(audits.map((entry) => entry.action)).toEqual([
      "git_provider.register",
      "git_provider.ca.update",
      "git_provider.ca.update"
    ]);
    expect(audits[0]?.metadata).toMatchObject({
      resourceId: registered.id,
      caCertificateId: "cert_provider_ca_a",
      caCertificateFingerprint: "sha256:provider-ca-a"
    });
    expect(audits[1]?.metadata).toMatchObject({
      resourceId: registered.id,
      previousCaCertificateId: "cert_provider_ca_a",
      previousCaCertificateFingerprint: "sha256:provider-ca-a",
      caCertificateId: "cert_provider_ca_b",
      caCertificateFingerprint: "sha256:provider-ca-b"
    });
    expect(audits[2]?.metadata).toMatchObject({
      previousCaCertificateId: "cert_provider_ca_b",
      previousCaCertificateFingerprint: "sha256:provider-ca-b",
      caCertificateId: null,
      caCertificateFingerprint: null
    });
    expect(JSON.stringify(audits)).not.toContain(testCaPem);
    expect(JSON.stringify(audits)).not.toContain("glpat-ca-token");
  });

  it("maps a cross-team CA to a safe validation error before making a network call", async () => {
    await db.insert(teams).values({
      id: "team_ca_contract_other",
      name: "CA Contract Other",
      slug: "ca-contract-other",
      createdByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });
    await createCertificate(
      "cert_provider_ca_other",
      "sha256:provider-ca-other",
      "team_ca_contract_other"
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      caller().registerGitProvider({
        type: "gitlab",
        name: "Cross team CA",
        baseUrl: "https://gitlab.example.test",
        caCertificateId: "cert_provider_ca_other",
        gitlabCredential: { kind: "api_token", token: "glpat-cross-team" }
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Git provider CA certificate is unavailable."
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a custom CA on plaintext provider URLs before saving or sending credentials", async () => {
    await createCertificate("cert_provider_ca_https_only", "sha256:provider-ca-https-only");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      caller().registerGitProvider({
        type: "gitlab",
        name: "Plaintext GitLab",
        baseUrl: "http://gitlab.example.test",
        caCertificateId: "cert_provider_ca_https_only",
        gitlabCredential: { kind: "api_token", token: "glpat-plaintext" }
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Custom Git provider CA trust requires HTTPS."
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await db.insert(gitProviders).values({
      id: "gitprov_plaintext_update",
      teamId: "team_foundation",
      type: "github",
      name: "Plaintext GitHub",
      baseUrl: "http://github.example.test",
      status: "active",
      updatedAt: new Date()
    });
    await expect(
      caller().updateGitProviderCa({
        providerId: "gitprov_plaintext_update",
        caCertificateId: "cert_provider_ca_https_only"
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Custom Git provider CA trust requires HTTPS."
    });
  });
});
