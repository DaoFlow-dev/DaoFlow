import { X509Certificate } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { decrypt } from "../crypto";
import { certificateAssets } from "../schema/access-assets";

const trustErrorMessage = "Git provider CA certificate is unavailable.";
const trustRequiresHttpsMessage = "Custom Git provider CA trust requires HTTPS.";

export class GitProviderCaTrustError extends Error {
  constructor(message = trustErrorMessage) {
    super(message);
    this.name = "GitProviderCaTrustError";
  }
}

export interface ResolvedGitProviderCa {
  certificateId: string;
  name: string;
  fingerprint: string;
  expiresAt: Date;
  pem: string;
}

export interface GitProviderCaReference {
  teamId: string;
  caCertificateId: string | null;
}

type BunTlsRequestInit = RequestInit & {
  tls?: { ca: string };
};

type FetchInput = Parameters<typeof fetch>[0];

function fetchInputUrl(input: FetchInput): URL {
  try {
    if (input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return input;
    return new URL(input);
  } catch {
    throw new GitProviderCaTrustError(trustRequiresHttpsMessage);
  }
}

export function assertGitProviderCaHttpsUrl(
  caOrNull: ResolvedGitProviderCa | null,
  input: FetchInput
): void {
  if (caOrNull && fetchInputUrl(input).protocol !== "https:") {
    throw new GitProviderCaTrustError(trustRequiresHttpsMessage);
  }
}

function parseTrustedCertificate(pem: string): Date {
  const certificate = new X509Certificate(pem);
  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  const now = new Date();

  if (
    !certificate.ca ||
    Number.isNaN(validFrom.getTime()) ||
    Number.isNaN(validTo.getTime()) ||
    now < validFrom ||
    now > validTo
  ) {
    throw new GitProviderCaTrustError();
  }

  return validTo;
}

export async function resolveGitProviderCa(input: {
  teamId: string;
  certificateId: string;
}): Promise<ResolvedGitProviderCa> {
  try {
    const [certificate] = await db
      .select({
        id: certificateAssets.id,
        name: certificateAssets.name,
        fingerprint: certificateAssets.fingerprint,
        certificatePemEncrypted: certificateAssets.certificatePemEncrypted,
        status: certificateAssets.status
      })
      .from(certificateAssets)
      .where(
        and(
          eq(certificateAssets.id, input.certificateId),
          eq(certificateAssets.teamId, input.teamId)
        )
      )
      .limit(1);

    if (!certificate || certificate.status !== "active") {
      throw new GitProviderCaTrustError();
    }

    const pem = decrypt(certificate.certificatePemEncrypted);
    const expiresAt = parseTrustedCertificate(pem);
    return {
      certificateId: certificate.id,
      name: certificate.name,
      fingerprint: certificate.fingerprint,
      expiresAt,
      pem
    };
  } catch (error) {
    if (error instanceof GitProviderCaTrustError) throw error;
    throw new GitProviderCaTrustError();
  }
}

export async function resolveGitProviderCaForProvider(
  reference: GitProviderCaReference
): Promise<ResolvedGitProviderCa | null> {
  if (!reference.caCertificateId) return null;
  return resolveGitProviderCa({
    teamId: reference.teamId,
    certificateId: reference.caCertificateId
  });
}

export async function fetchWithResolvedGitProviderCa(
  caOrNull: ResolvedGitProviderCa | null,
  input: FetchInput,
  init?: RequestInit
): Promise<Response> {
  if (!caOrNull) return fetch(input, init);
  assertGitProviderCaHttpsUrl(caOrNull, input);

  const { tls: _ignoredTls, ...requestInit } = (init ?? {}) as BunTlsRequestInit;
  return fetch(input, {
    ...requestInit,
    tls: { ca: caOrNull.pem }
  } as BunTlsRequestInit);
}

export async function fetchWithGitProviderCa(
  reference: GitProviderCaReference,
  input: FetchInput,
  init?: RequestInit
): Promise<Response> {
  const ca = await resolveGitProviderCaForProvider(reference);
  return fetchWithResolvedGitProviderCa(ca, input, init);
}
