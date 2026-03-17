import { describe, expect, it } from "vitest";
import { resolveExecutionTarget } from "./execution-target";

describe("resolveExecutionTarget", () => {
  it("keeps localhost servers on the local executor", () => {
    const target = resolveExecutionTarget(
      {
        id: "srv_local",
        name: "local-dev",
        host: "127.0.0.1",
        region: null,
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

    expect(target).toEqual({ mode: "local" });
  });

  it("routes non-local servers through SSH with a deterministic remote workdir", () => {
    const target = resolveExecutionTarget(
      {
        id: "srv_remote",
        name: "staging-vps",
        host: "203.0.113.10",
        region: null,
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
    expect(target.remoteWorkDir).toBe("/tmp/daoflow-staging/dep_456");
  });
});
