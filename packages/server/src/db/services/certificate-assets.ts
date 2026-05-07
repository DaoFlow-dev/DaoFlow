import { createHash, X509Certificate } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { certificateAssets } from "../schema/access-assets";
import { newId } from "./json-helpers";
import { recordAccessAssetAudit, type AccessAssetActor } from "./access-assets";

function hashMaterial(value: string) {
  return `sha256:${createHash("sha256").update(value.trim()).digest("base64url")}`;
}

function inferCertificateMetadata(certificatePem: string) {
  try {
    const cert = new X509Certificate(certificatePem);
    return {
      fingerprint: `sha256:${cert.fingerprint256.toLowerCase().replaceAll(":", "")}`,
      subject: cert.subject,
      issuer: cert.issuer,
      expiresAt: new Date(cert.validTo),
      domains: cert.subjectAltName
        ? cert.subjectAltName
            .split(",")
            .map((entry) => entry.trim().replace(/^DNS:/, ""))
            .filter(Boolean)
        : []
    };
  } catch {
    return {
      fingerprint: hashMaterial(certificatePem),
      subject: null,
      issuer: null,
      expiresAt: null,
      domains: []
    };
  }
}

function serializeCertificate(row: typeof certificateAssets.$inferSelect) {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    fingerprint: row.fingerprint,
    subject: row.subject,
    issuer: row.issuer,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    domains: Array.isArray(row.domains)
      ? row.domains.filter((item): item is string => typeof item === "string")
      : [],
    hasPrivateKey: Boolean(row.privateKeyEncrypted),
    hasCaChain: Boolean(row.caChainEncrypted),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function createCertificateAsset(input: {
  teamId: string;
  name: string;
  certificatePem: string;
  privateKey?: string | null;
  caChain?: string | null;
  actor: AccessAssetActor;
}) {
  const metadata = inferCertificateMetadata(input.certificatePem);
  const [row] = await db
    .insert(certificateAssets)
    .values({
      id: newId(),
      teamId: input.teamId,
      name: input.name,
      certificatePemEncrypted: encrypt(input.certificatePem.trim()),
      privateKeyEncrypted: input.privateKey?.trim() ? encrypt(input.privateKey.trim()) : null,
      caChainEncrypted: input.caChain?.trim() ? encrypt(input.caChain.trim()) : null,
      fingerprint: metadata.fingerprint,
      subject: metadata.subject,
      issuer: metadata.issuer,
      expiresAt: metadata.expiresAt,
      domains: metadata.domains,
      createdByUserId: input.actor.requestedByUserId,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();
  const summary = `Created certificate asset ${row.name}.`;
  await recordAccessAssetAudit({
    actor: input.actor,
    targetResource: `certificate/${row.id}`,
    action: "certificate.create",
    summary,
    resourceType: "certificate",
    resourceId: row.id,
    resourceLabel: row.name
  });
  return serializeCertificate(row);
}

export async function listCertificateAssets(teamId: string) {
  const rows = await db
    .select()
    .from(certificateAssets)
    .where(eq(certificateAssets.teamId, teamId))
    .orderBy(desc(certificateAssets.createdAt));
  return rows.map(serializeCertificate);
}

export async function deleteCertificateAsset(input: {
  teamId: string;
  certificateId: string;
  actor: AccessAssetActor;
}) {
  const [current] = await db
    .select()
    .from(certificateAssets)
    .where(
      and(eq(certificateAssets.id, input.certificateId), eq(certificateAssets.teamId, input.teamId))
    )
    .limit(1);
  if (!current) return null;
  await db.delete(certificateAssets).where(eq(certificateAssets.id, input.certificateId));
  const summary = `Deleted certificate asset ${current.name}.`;
  await recordAccessAssetAudit({
    actor: input.actor,
    targetResource: `certificate/${current.id}`,
    action: "certificate.delete",
    summary,
    resourceType: "certificate",
    resourceId: current.id,
    resourceLabel: current.name
  });
  return { deleted: true as const, certificateId: input.certificateId };
}
