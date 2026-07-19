import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { certificateAssets } from "../schema/access-assets";
import { teams } from "../schema/teams";
import { resetSeededTestDatabase } from "../../test-db";
import {
  fetchWithGitProviderCa,
  fetchWithResolvedGitProviderCa,
  resolveGitProviderCa,
  resolveGitProviderCaForProvider
} from "./git-provider-ca-trust";

const teamId = "team_foundation";
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
const testLeafPem = `-----BEGIN CERTIFICATE-----
MIIDIzCCAgugAwIBAgIUNCFuU0wsMsYQRhixjUMWF6wn//gwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRRGFvRmxvdyBUZXN0IExlYWYwHhcNMjYwNzE5MTA0NDIz
WhcNMzYwNzE2MTA0NDIzWjAcMRowGAYDVQQDDBFEYW9GbG93IFRlc3QgTGVhZjCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMyYgs5xLqGyfvM3YEWLjQX1
4cB5E61v0xwrcnJq0SaQumIoe9M02jWVZspZzv3xRkY7GxQB3k7TAE7vN4x9sF+/
yvqPT0jtutpHgsjwXbNaredTMUTFIXgxX7hUK7AwAAZy7cJh0aRvGePeHb0ljTqm
Xp7jkQKmGMAQtqI6/e2af0vGj3edQ2VP1yOztCuYUjbWiEUHWu2Rczi8aCDIPWkV
KLR0MPylp7tLZ8tMIHtn2W3IW7GBZpIzw5Rkk/sud0jAbfJLoFtne9v8ps/JbQ6i
h5QEI50ebbZwKljV57bNlpngtaU6DKTBvIj6XPOACE6Jo/AfmjyqTRLx5zLXJLcC
AwEAAaNdMFswHQYDVR0OBBYAFEcqL7w51Wx6Yod6NBiqCV1fxqwsMB8GA1UdIwQY
MBaAFEcqL7w51Wx6Yod6NBiqCV1fxqwsMAwGA1UdEwEB/wQCMAAwCwYDVR0PBAQD
AgWgMA0GCSqGSIb3DQEBCwUAA4IBAQAQuf+K89i686G136E+zQve6QepEtCo5wfB
SaWbTpx+l7uODzR17jjj+xwGAh+lSQN+WSXGa16Bhkk55JhietyPCc/vMyGIi/ub
CYVXOzN01VnwD77nw6AEF5irXww+buOQF0HEZzLwP3mhYUsZkxgvxsfhjS0YKhpr
rvz7wPJ+YW55/88kW6JK0BqrEVbjrUCdN2PJ1owAMrqmpen7/OyqS5PC8lbUJewl
M8kaZaWehgzW+AUZ7fz/WE11ucfGtvmYLb/PS/H5roY83dQ7ia//mTL+Bx8Elg3g
IGe6rdPEBMV9RDFmYsb1TF+oD5W6ggiDw1GD9QttECXifk1tOjQz
-----END CERTIFICATE-----`;

async function createCertificate(input: {
  id: string;
  pem?: string;
  status?: "active" | "inactive";
  teamId?: string;
}) {
  await db.insert(certificateAssets).values({
    id: input.id,
    teamId: input.teamId ?? teamId,
    name: input.id,
    certificatePemEncrypted: encrypt(input.pem ?? testCaPem),
    privateKeyEncrypted: "not-a-decryptable-private-key",
    caChainEncrypted: "not-a-decryptable-ca-chain",
    fingerprint: `sha256:${input.id}`,
    status: input.status ?? "active",
    updatedAt: new Date()
  });
}

function expectTrustFailure(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    name: "GitProviderCaTrustError",
    message: "Git provider CA certificate is unavailable."
  });
}

describe("git provider CA trust", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves only an active, valid team CA and applies it to one fetch call", async () => {
    await createCertificate({ id: "cert_provider_ca" });

    const ca = await resolveGitProviderCa({ teamId, certificateId: "cert_provider_ca" });
    expect(ca).toMatchObject({
      certificateId: "cert_provider_ca",
      name: "cert_provider_ca",
      fingerprint: "sha256:cert_provider_ca",
      pem: testCaPem
    });
    expect(ca.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(ca)).not.toContain("not-a-decryptable-private-key");
    expect(JSON.stringify(ca)).not.toContain("not-a-decryptable-ca-chain");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await fetchWithResolvedGitProviderCa(ca, "https://git.example.test/api", {
      headers: { Accept: "application/json" },
      tls: { ca: "ignored-untrusted-ca" }
    } as RequestInit);
    await fetchWithGitProviderCa(
      { teamId, caCertificateId: "cert_provider_ca" },
      "https://git.example.test/again"
    );
    await fetchWithResolvedGitProviderCa(null, "https://git.example.test/public", {
      headers: { Accept: "application/json" }
    });
    await expect(
      fetchWithResolvedGitProviderCa(ca, "http://git.example.test/insecure")
    ).rejects.toMatchObject({
      name: "GitProviderCaTrustError",
      message: "Custom Git provider CA trust requires HTTPS."
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://git.example.test/api",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        tls: { ca: testCaPem }
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://git.example.test/again",
      expect.objectContaining({ tls: { ca: testCaPem } })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://git.example.test/public", {
      headers: { Accept: "application/json" }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(
      resolveGitProviderCaForProvider({ teamId, caCertificateId: null })
    ).resolves.toBeNull();
  });

  it("fails closed for missing, cross-team, inactive, malformed, non-CA, and expired assets", async () => {
    await createCertificate({ id: "cert_inactive", status: "inactive" });
    await createCertificate({ id: "cert_malformed", pem: "not a certificate" });
    await createCertificate({ id: "cert_leaf", pem: testLeafPem });
    await db.insert(teams).values({
      id: "team_ca_other",
      name: "CA Other Team",
      slug: "ca-other-team",
      createdByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });
    await createCertificate({ id: "cert_other_team", teamId: "team_ca_other" });
    await createCertificate({ id: "cert_expired" });

    await expectTrustFailure(resolveGitProviderCa({ teamId, certificateId: "cert_missing" }));
    await expectTrustFailure(resolveGitProviderCa({ teamId, certificateId: "cert_inactive" }));
    await expectTrustFailure(resolveGitProviderCa({ teamId, certificateId: "cert_malformed" }));
    await expectTrustFailure(resolveGitProviderCa({ teamId, certificateId: "cert_leaf" }));
    await expectTrustFailure(resolveGitProviderCa({ teamId, certificateId: "cert_other_team" }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2037-01-01T00:00:00.000Z"));
    await expectTrustFailure(resolveGitProviderCa({ teamId, certificateId: "cert_expired" }));
  });
});
