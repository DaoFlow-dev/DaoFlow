import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/connection";
import { sandboxRunnerProfiles } from "./db/schema/development-tasks";
import { servers } from "./db/schema/servers";
import { resetSeededTestDatabase } from "./test-db";
import {
  ensureLocalhostServer,
  resetLocalhostServerBootstrapState
} from "./bootstrap-localhost-server";

describe("bootstrapLocalhostServer", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
    resetLocalhostServerBootstrapState();
  });

  it("inserts a localhost server when none exists", async () => {
    // Remove any existing localhost server from seed data
    await db.delete(servers).where(eq(servers.host, "localhost"));

    await ensureLocalhostServer();

    const [row] = await db.select().from(servers).where(eq(servers.host, "localhost")).limit(1);

    expect(row).toBeDefined();
    expect(row.name).toBe("localhost");
    expect(row.host).toBe("localhost");
    expect(row.kind).toBe("docker-engine");
    expect(row.region).toBe("local");
    expect(row.teamId).toBe("team_foundation");

    const [runnerProfile] = await db
      .select()
      .from(sandboxRunnerProfiles)
      .where(eq(sandboxRunnerProfiles.id, "runner_profile_host_default"))
      .limit(1);
    expect(runnerProfile).toMatchObject({
      provider: "host_docker",
      serverId: row.id,
      status: "enabled"
    });

    const [boxLiteProfile] = await db
      .select()
      .from(sandboxRunnerProfiles)
      .where(eq(sandboxRunnerProfiles.id, "runner_profile_boxlite_default"))
      .limit(1);
    expect(boxLiteProfile).toMatchObject({
      provider: "sandbank_boxlite",
      serverId: row.id,
      status: "disabled"
    });
  });

  it("skips registration when a localhost server already exists", async () => {
    // Remove any existing localhost server, then insert one manually
    await db.delete(servers).where(eq(servers.host, "localhost"));
    await db.insert(servers).values({
      id: "srv_existing_localhost",
      name: "existing-local",
      host: "localhost",
      region: "local",
      sshPort: 22,
      kind: "docker-engine",
      status: "ready",
      metadata: {},
      updatedAt: new Date()
    });
    await db
      .update(sandboxRunnerProfiles)
      .set({
        allowedCommands: [],
        metadata: {
          operatorNote: "preserve me"
        },
        updatedAt: new Date()
      })
      .where(eq(sandboxRunnerProfiles.id, "runner_profile_host_default"));

    resetLocalhostServerBootstrapState();
    await ensureLocalhostServer();

    const rows = await db.select().from(servers).where(eq(servers.host, "localhost"));

    // Should still be exactly one — the original, not a duplicate
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("srv_existing_localhost");
    expect(rows[0].teamId).toBe("team_foundation");

    const [runnerProfile] = await db
      .select()
      .from(sandboxRunnerProfiles)
      .where(eq(sandboxRunnerProfiles.id, "runner_profile_host_default"))
      .limit(1);
    expect(runnerProfile).toMatchObject({
      serverId: "srv_existing_localhost",
      status: "enabled",
      codexAuthMode: "custom_provider_env"
    });
    expect(runnerProfile.metadata).toMatchObject({
      operatorNote: "preserve me",
      hostServerDefault: true
    });
    expect(runnerProfile.allowedCommands).toEqual(runnerProfile.validationCommands);
    expect(runnerProfile.codexConfigTemplate).toContain('base_url = "https://api.openai.com/v1"');
    expect(runnerProfile.codexConfigTemplate).not.toContain("${");

    const [boxLiteProfile] = await db
      .select()
      .from(sandboxRunnerProfiles)
      .where(eq(sandboxRunnerProfiles.id, "runner_profile_boxlite_default"))
      .limit(1);
    expect(boxLiteProfile).toMatchObject({
      serverId: "srv_existing_localhost",
      status: "disabled",
      codexAuthMode: "custom_provider_env"
    });
    expect(boxLiteProfile.metadata).toMatchObject({
      hostServerDefault: true,
      sandbankProvider: "sandbank_boxlite"
    });
  });

  it("is idempotent across multiple calls", async () => {
    await db.delete(servers).where(eq(servers.host, "localhost"));

    await ensureLocalhostServer();

    // Second call should be a no-op (cached promise)
    await ensureLocalhostServer();

    const rows = await db.select().from(servers).where(eq(servers.host, "localhost"));

    expect(rows).toHaveLength(1);
  });
});
