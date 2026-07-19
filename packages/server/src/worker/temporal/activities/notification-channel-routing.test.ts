import { describe, expect, test } from "vitest";
import { matchesNotificationChannelRouting } from "./notification-channel-routing";

const payload = {
  eventType: "server.metrics.warning" as const,
  projectName: "foundation",
  environmentName: "production"
};

describe("notification channel routing", () => {
  test("requires the event selector and every configured resource filter to match", () => {
    expect(
      matchesNotificationChannelRouting(
        {
          eventSelectors: ["server.metrics.*"],
          projectFilter: "foundation",
          environmentFilter: "production"
        },
        payload
      )
    ).toBe(true);
  });

  test("rejects unmatched events, projects, and environments", () => {
    expect(
      matchesNotificationChannelRouting(
        { eventSelectors: ["backup.*"], projectFilter: null, environmentFilter: null },
        payload
      )
    ).toBe(false);
    expect(
      matchesNotificationChannelRouting(
        { eventSelectors: ["*"], projectFilter: "other", environmentFilter: null },
        payload
      )
    ).toBe(false);
    expect(
      matchesNotificationChannelRouting(
        { eventSelectors: ["*"], projectFilter: null, environmentFilter: "staging" },
        payload
      )
    ).toBe(false);
  });
});
