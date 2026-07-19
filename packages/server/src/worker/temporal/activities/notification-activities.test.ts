import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { notificationChannels } from "../../../db/schema/notifications";
import { resetTestDatabaseWithControlPlane } from "../../../test-db";
import { dispatchNotificationToChannel } from "./notification-activities";

const payload = {
  eventType: "system.test" as const,
  teamId: "team_foundation",
  title: "Direct delivery test",
  message: "Direct channel routing must stay within the team.",
  severity: "info" as const,
  projectName: "foundation",
  environmentName: "production"
};

describe("direct notification delivery", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    await db.insert(notificationChannels).values({
      id: "nch_direct_foundation",
      teamId: "team_foundation",
      name: "Foundation direct channel",
      channelType: "generic_webhook",
      webhookUrl: "https://hooks.example.test/foundation-direct",
      eventSelectors: ["system.test"],
      enabled: true,
      projectFilter: "foundation",
      environmentFilter: "production",
      metadata: {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("enforces team ownership and normal routing unless explicitly bypassed", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const matching = await dispatchNotificationToChannel("nch_direct_foundation", payload);
    expect(matching).toMatchObject({ dispatched: 1, succeeded: 1, failed: 0 });

    const mismatchedTeam = await dispatchNotificationToChannel("nch_direct_foundation", payload, {
      ignoreRouting: true,
      expectedTeamId: "team_other"
    });
    expect(mismatchedTeam).toMatchObject({ dispatched: 0, succeeded: 0, failed: 1 });

    const mismatchedEnvironment = await dispatchNotificationToChannel("nch_direct_foundation", {
      ...payload,
      environmentName: "staging"
    });
    expect(mismatchedEnvironment).toMatchObject({ dispatched: 0, succeeded: 0, failed: 1 });

    const mismatchedEvent = await dispatchNotificationToChannel("nch_direct_foundation", {
      ...payload,
      eventType: "backup.started"
    });
    expect(mismatchedEvent).toMatchObject({ dispatched: 0, succeeded: 0, failed: 1 });

    await db
      .update(notificationChannels)
      .set({ enabled: false })
      .where(eq(notificationChannels.id, "nch_direct_foundation"));
    const disabled = await dispatchNotificationToChannel("nch_direct_foundation", payload);
    expect(disabled).toMatchObject({ dispatched: 0, succeeded: 0, failed: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
