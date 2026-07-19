import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { serverMetricPolicies, serverMetricStates } from "../schema/server-metrics";
import { servers } from "../schema/servers";
import { teams } from "../schema/teams";
import { resetTestDatabase } from "../../test-db";
import { listServersDueForMetricCollection } from "./server-metrics";

const now = new Date("2026-07-18T12:00:00.000Z");
const teamId = "team_metrics_due";

async function createTeam() {
  await db.insert(teams).values({
    id: teamId,
    name: "Metrics Due Team",
    slug: "metrics-due-team",
    createdAt: now,
    updatedAt: now
  });
}

async function createServer(input: {
  id: string;
  lastCheckedAt?: Date;
  sampleIntervalSeconds?: number;
}) {
  await db.insert(servers).values({
    id: input.id,
    name: input.id,
    host: `${input.id}.example.invalid`,
    teamId,
    status: "ready",
    createdAt: now,
    updatedAt: now
  });

  if (input.lastCheckedAt) {
    await db.insert(serverMetricStates).values({
      serverId: input.id,
      lastCheckedAt: input.lastCheckedAt,
      updatedAt: now
    });
  }

  if (input.sampleIntervalSeconds !== undefined) {
    await db.insert(serverMetricPolicies).values({
      serverId: input.id,
      sampleIntervalSeconds: input.sampleIntervalSeconds,
      createdAt: now,
      updatedAt: now
    });
  }
}

describe("server metric due selection PostgreSQL integration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns no servers for an empty fresh database", async () => {
    await expect(listServersDueForMetricCollection({ now })).resolves.toEqual([]);
  });

  it("returns a never-checked ready server with a team", async () => {
    await createTeam();
    await createServer({ id: "srv_metrics_never" });

    const due = await listServersDueForMetricCollection({ now });

    expect(due.map((candidate) => candidate.server.id)).toEqual(["srv_metrics_never"]);
  });

  it("does not return a recently checked server using the default interval", async () => {
    await createTeam();
    await createServer({
      id: "srv_metrics_recent",
      lastCheckedAt: new Date(now.getTime() - 30_000)
    });

    const due = await listServersDueForMetricCollection({ now });

    expect(due).toEqual([]);
  });

  it("returns an old server using the default interval", async () => {
    await createTeam();
    await createServer({
      id: "srv_metrics_old",
      lastCheckedAt: new Date(now.getTime() - 90_000)
    });

    const due = await listServersDueForMetricCollection({ now });

    expect(due.map((candidate) => candidate.server.id)).toEqual(["srv_metrics_old"]);
  });

  it("uses a custom sample interval and includes the exact due boundary", async () => {
    await createTeam();
    await createServer({
      id: "srv_metrics_custom_due",
      lastCheckedAt: new Date(now.getTime() - 301_000),
      sampleIntervalSeconds: 300
    });
    await createServer({
      id: "srv_metrics_custom_boundary",
      lastCheckedAt: new Date(now.getTime() - 300_000),
      sampleIntervalSeconds: 300
    });
    await createServer({
      id: "srv_metrics_custom_recent",
      lastCheckedAt: new Date(now.getTime() - 299_000),
      sampleIntervalSeconds: 300
    });

    const due = await listServersDueForMetricCollection({ now });

    expect(due.map((candidate) => candidate.server.id)).toEqual([
      "srv_metrics_custom_due",
      "srv_metrics_custom_boundary"
    ]);
  });
});
