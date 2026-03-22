import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import { resetTestDatabase } from "../../test-db";
import { createDestination, updateDestination } from "./destinations";

const actor = {
  userId: "user_destination_owner",
  email: "owner@daoflow.local",
  role: "owner" as const
};

describe("destinations", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("normalizes OAuth tokens on destination creation", async () => {
    const destination = await createDestination(
      {
        name: "Drive backups",
        provider: "gdrive",
        oauthToken: '{\n  "access_token": "token-1",\n  "refresh_token": "refresh-1"\n}'
      },
      actor.userId,
      actor.email,
      actor.role
    );

    const [storedDestination] = await db
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.id, destination.id))
      .limit(1);

    expect(storedDestination?.oauthToken).toBe(
      '{"access_token":"token-1","refresh_token":"refresh-1"}'
    );
  });

  it("normalizes OAuth tokens on destination update", async () => {
    const destination = await createDestination(
      {
        name: "Drive backups",
        provider: "gdrive",
        oauthToken: '{"access_token":"token-1"}'
      },
      actor.userId,
      actor.email,
      actor.role
    );

    await updateDestination(
      {
        id: destination.id,
        oauthToken: '{\n  "access_token": "token-2",\n  "refresh_token": "refresh-2"\n}'
      },
      actor.userId,
      actor.email,
      actor.role
    );

    const [storedDestination] = await db
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.id, destination.id))
      .limit(1);

    expect(storedDestination?.oauthToken).toBe(
      '{"access_token":"token-2","refresh_token":"refresh-2"}'
    );
  });

  it("rejects invalid OAuth token JSON during destination updates", async () => {
    const destination = await createDestination(
      {
        name: "Drive backups",
        provider: "gdrive",
        oauthToken: '{"access_token":"token-1"}'
      },
      actor.userId,
      actor.email,
      actor.role
    );

    await expect(
      updateDestination(
        {
          id: destination.id,
          oauthToken: "{not-json"
        },
        actor.userId,
        actor.email,
        actor.role
      )
    ).rejects.toThrow("Invalid OAuth token: must be valid JSON from 'rclone authorize'.");

    const [storedDestination] = await db
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.id, destination.id))
      .limit(1);

    expect(storedDestination?.oauthToken).toBe('{"access_token":"token-1"}');
  });
});
