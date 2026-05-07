import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { certificateAssets, managedSshKeys } from "../schema/access-assets";
import { servers } from "../schema/servers";
import { resetSeededTestDatabase } from "../../test-db";
import {
  attachManagedSshKeyToServer,
  createManagedSshKey,
  deleteManagedSshKey,
  detachManagedSshKeyFromServer,
  listManagedSshKeys,
  rotateManagedSshKey
} from "./access-assets";
import {
  createCertificateAsset,
  deleteCertificateAsset,
  listCertificateAssets
} from "./certificate-assets";

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};
const teamId = "team_foundation";

describe("access asset services", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
  });

  it("stores managed SSH keys encrypted and returns redacted summaries", async () => {
    const key = await createManagedSshKey({
      teamId,
      name: "prod-deploy",
      username: "deploy",
      privateKey: "fixture-private-key",
      actor
    });
    await rotateManagedSshKey({
      teamId,
      keyId: key.id,
      privateKey: "fixture-rotated-key",
      actor
    });

    const [row] = await db.select().from(managedSshKeys).where(eq(managedSshKeys.id, key.id));
    expect(row.privateKeyEncrypted).not.toContain("fixture");
    expect(decrypt(row.privateKeyEncrypted)).toBe("fixture-rotated-key");

    const summaries = await listManagedSshKeys(teamId);
    expect(summaries[0]).toMatchObject({
      id: key.id,
      name: "prod-deploy",
      username: "deploy",
      hasPrivateKey: true
    });
    expect(JSON.stringify(summaries)).not.toContain("fixture-rotated-key");

    const audits = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `ssh-key/${key.id}`));
    expect(audits.map((entry) => entry.action)).toEqual(["ssh_key.create", "ssh_key.rotate"]);
  });

  it("attaches managed SSH keys to servers and clears legacy per-server key material", async () => {
    const key = await createManagedSshKey({
      teamId,
      name: "edge-key",
      username: "deployer",
      privateKey: "fixture-private-key",
      actor
    });
    await db
      .update(servers)
      .set({ sshPrivateKeyEncrypted: encrypt("legacy-key") })
      .where(eq(servers.id, "srv_foundation_1"));

    const result = await attachManagedSshKeyToServer({
      teamId,
      keyId: key.id,
      serverId: "srv_foundation_1",
      actor
    });
    expect(result?.server).toMatchObject({
      id: "srv_foundation_1",
      sshKeyId: key.id,
      sshPrivateKeyEncrypted: null,
      sshUser: "deployer"
    });

    const detached = await detachManagedSshKeyFromServer({
      teamId,
      serverId: "srv_foundation_1",
      actor
    });
    expect(detached?.detachedKeyId).toBe(key.id);
    expect(detached?.server.sshKeyId).toBeNull();

    await attachManagedSshKeyToServer({
      teamId,
      keyId: key.id,
      serverId: "srv_foundation_1",
      actor
    });

    await deleteManagedSshKey({ teamId, keyId: key.id, actor });
    const [server] = await db.select().from(servers).where(eq(servers.id, "srv_foundation_1"));
    expect(server.sshKeyId).toBeNull();
  });

  it("stores certificate assets encrypted and returns safe certificate metadata", async () => {
    const certificate = await createCertificateAsset({
      teamId,
      name: "wildcard-example",
      certificatePem: "-----BEGIN CERTIFICATE-----\nfixture-cert\n-----END CERTIFICATE-----",
      privateKey: "fixture-cert-key",
      caChain: "fixture-ca",
      actor
    });
    const [row] = await db
      .select()
      .from(certificateAssets)
      .where(eq(certificateAssets.id, certificate.id));
    expect(row.certificatePemEncrypted).not.toContain("fixture-cert");
    expect(decrypt(row.privateKeyEncrypted!)).toBe("fixture-cert-key");

    const summaries = await listCertificateAssets(teamId);
    expect(summaries[0]).toMatchObject({
      id: certificate.id,
      name: "wildcard-example",
      hasPrivateKey: true,
      hasCaChain: true
    });
    expect(JSON.stringify(summaries)).not.toContain("fixture-cert-key");

    await deleteCertificateAsset({
      teamId,
      certificateId: certificate.id,
      actor
    });
    const remaining = await listCertificateAssets(teamId);
    expect(remaining).toHaveLength(0);
  });
});
