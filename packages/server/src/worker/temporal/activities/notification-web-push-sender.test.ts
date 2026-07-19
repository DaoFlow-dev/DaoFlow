import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import webpush from "web-push";
import { db } from "../../../db/connection";
import { pushSubscriptions } from "../../../db/schema/notifications";
import { teamMembers, teams } from "../../../db/schema/teams";
import { users } from "../../../db/schema/users";
import { resetTestDatabaseWithControlPlane } from "../../../test-db";
import { sendWebPushNotifications } from "./notification-web-push-sender";

const vapidKeys = webpush.generateVAPIDKeys();
const initialVapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const initialVapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const initialVapidSubject = process.env.VAPID_SUBJECT;

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnvironment("VAPID_PUBLIC_KEY", initialVapidPublicKey);
  restoreEnvironment("VAPID_PRIVATE_KEY", initialVapidPrivateKey);
  restoreEnvironment("VAPID_SUBJECT", initialVapidSubject);
});

describe("web push notification routing", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:notifications@daoflow.test";
  });

  test("sends only to subscriptions owned by members of the payload team", async () => {
    const otherTeamId = "team_push_other";
    const otherUserId = "user_push_other";

    await db.insert(users).values({
      id: otherUserId,
      email: "push-other@daoflow.test",
      name: "Push Other",
      username: otherUserId,
      emailVerified: true,
      role: "member",
      status: "active",
      defaultTeamId: otherTeamId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await db.insert(teams).values({
      id: otherTeamId,
      name: "Push Other Team",
      slug: "push-other-team",
      status: "active",
      createdByUserId: otherUserId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await db.insert(teamMembers).values({
      id: 991_221,
      teamId: otherTeamId,
      userId: otherUserId,
      role: "owner",
      createdAt: new Date()
    });
    await db.insert(pushSubscriptions).values([
      {
        id: "push_foundation",
        userId: "user_foundation_owner",
        endpoint: "https://push.example.test/foundation",
        p256dh: "foundation-p256dh",
        auth: "foundation-auth",
        userAgent: "test",
        createdAt: new Date()
      },
      {
        id: "push_other",
        userId: otherUserId,
        endpoint: "https://push.example.test/other",
        p256dh: "other-p256dh",
        auth: "other-auth",
        userAgent: "test",
        createdAt: new Date()
      }
    ]);

    const sentEndpoints: string[] = [];
    vi.spyOn(webpush, "sendNotification").mockImplementation((subscription) => {
      sentEndpoints.push(subscription.endpoint);
      return Promise.resolve({ statusCode: 201 } as never);
    });

    const result = await sendWebPushNotifications({
      eventType: "system.test",
      teamId: "team_foundation",
      title: "Foundation test",
      message: "Only foundation members should receive this.",
      severity: "info"
    });

    expect(result).toMatchObject({ ok: true, httpStatus: 200 });
    expect(sentEndpoints).toEqual(["https://push.example.test/foundation"]);
  });
});
