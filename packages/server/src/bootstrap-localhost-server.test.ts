import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/connection";
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

    resetLocalhostServerBootstrapState();
    await ensureLocalhostServer();

    const rows = await db.select().from(servers).where(eq(servers.host, "localhost"));

    // Should still be exactly one — the original, not a duplicate
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("srv_existing_localhost");
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
