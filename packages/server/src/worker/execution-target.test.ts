import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApprovedSshHostIdentityMock } = vi.hoisted(() => ({
  getApprovedSshHostIdentityMock: vi.fn()
}));

vi.mock("../db/services/ssh-host-identities", () => ({
  getApprovedSshHostIdentity: getApprovedSshHostIdentityMock,
  toManagedSshHostIdentity: (identity: unknown) => identity
}));

import { resolveExecutionTarget } from "./execution-target";

describe("resolveExecutionTarget", () => {
  beforeEach(() => {
    getApprovedSshHostIdentityMock.mockReset();
  });
  it("keeps localhost servers on the local executor", async () => {
    const target = await resolveExecutionTarget(
      {
        id: "srv_local",
        name: "local-dev",
        host: "127.0.0.1",
        region: null,
        teamId: null,
        sshPort: 22,
        sshUser: null,
        sshKeyId: null,
        sshPrivateKeyEncrypted: null,
        kind: "docker-engine",
        status: "ready",
        dockerVersion: null,
        composeVersion: null,
        metadata: {},
        registeredByUserId: null,
        lastCheckedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      "dep_123"
    );

    expect(target).toEqual({ mode: "local", serverKind: "docker-engine" });
  });

  it("routes non-local servers through SSH with a deterministic remote workdir", async () => {
    getApprovedSshHostIdentityMock.mockResolvedValue({
      teamId: "team_foundation",
      serverId: "srv_remote",
      algorithm: "ssh-ed25519",
      publicKey: "AQIDBA==",
      fingerprint: "SHA256:njFZ9CldG7n9OP7eYq+LEZ7I8WWzhSgPOFdC8gV8v0c"
    });
    const target = await resolveExecutionTarget(
      {
        id: "srv_remote",
        name: "staging-vps",
        host: "203.0.113.10",
        region: null,
        teamId: "team_foundation",
        sshPort: 2222,
        sshUser: "deploy",
        sshKeyId: null,
        sshPrivateKeyEncrypted: null,
        kind: "docker-engine",
        status: "ready",
        dockerVersion: null,
        composeVersion: null,
        metadata: {},
        registeredByUserId: null,
        lastCheckedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      "dep_456"
    );

    expect(target.mode).toBe("remote");
    if (target.mode !== "remote") {
      throw new Error("expected remote target");
    }

    expect(target.ssh.serverName).toBe("staging-vps");
    expect(target.ssh.host).toBe("203.0.113.10");
    expect(target.ssh.port).toBe(2222);
    expect(target.ssh.user).toBe("deploy");
    expect(target.ssh.hostIdentity).toMatchObject({
      teamId: "team_foundation",
      serverId: "srv_remote",
      algorithm: "ssh-ed25519"
    });
    expect(target.remoteWorkDir).toBe("/tmp/daoflow-staging/dep_456");
    expect(target.serverKind).toBe("docker-engine");
  });

  it("fails closed for remote servers without an approved host identity", async () => {
    getApprovedSshHostIdentityMock.mockResolvedValue(null);

    await expect(
      resolveExecutionTarget(
        {
          id: "srv_unapproved",
          name: "unapproved-vps",
          host: "203.0.113.11",
          region: null,
          teamId: "team_foundation",
          sshPort: 22,
          sshUser: "debian",
          sshKeyId: null,
          sshPrivateKeyEncrypted: null,
          kind: "docker-engine",
          status: "pending host identity approval",
          dockerVersion: null,
          composeVersion: null,
          metadata: {},
          registeredByUserId: null,
          lastCheckedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        "dep_789"
      )
    ).rejects.toThrow("will not send credentials or commands");
  });
});
