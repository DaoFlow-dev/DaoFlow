import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./connection";
import { teams } from "./schema/teams";
import { resetTestDatabaseWithControlPlane } from "../test-db";

describe("database transactions", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("pins all statements to one PostgreSQL connection and rolls back atomically", async () => {
    const teamId = `team_tx_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const backendIds: number[] = [];

    await expect(
      db.transaction(async (tx) => {
        const first = await tx.execute(sql`select pg_backend_pid() as backend_id`);
        backendIds.push(Number(first.rows[0]?.backend_id));

        await tx.insert(teams).values({
          id: teamId,
          name: "Rolled Back Team",
          slug: teamId,
          status: "active",
          createdByUserId: "user_foundation_owner",
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const second = await tx.execute(sql`select pg_backend_pid() as backend_id`);
        backendIds.push(Number(second.rows[0]?.backend_id));

        throw new Error("rollback transaction fixture");
      })
    ).rejects.toThrow("rollback transaction fixture");

    expect(backendIds).toHaveLength(2);
    expect(backendIds[0]).toBe(backendIds[1]);

    const [persisted] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    expect(persisted).toBeUndefined();
  });
});
