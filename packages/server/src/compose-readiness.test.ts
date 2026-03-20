import { describe, expect, it } from "vitest";
import {
  buildComposeReadinessProbeUrl,
  describeComposeReadinessProbe,
  readComposeReadinessProbe,
  snapshotComposeReadinessProbe
} from "./compose-readiness";

describe("compose readiness", () => {
  it("normalizes internal-network HTTP readiness probes", () => {
    const probe = readComposeReadinessProbe({
      type: "http",
      target: "internal-network",
      port: 8080,
      path: "/ready"
    });

    expect(probe).toEqual({
      type: "http",
      target: "internal-network",
      port: 8080,
      path: "/ready",
      scheme: "http",
      timeoutSeconds: 60,
      intervalSeconds: 3,
      successStatusCodes: [200]
    });
    expect(buildComposeReadinessProbeUrl(probe!, "api")).toBe("http://api:8080/ready");
    expect(describeComposeReadinessProbe(probe!, "api")).toBe(
      "HTTP readiness on compose internal network http://api:8080/ready expecting 200 within 60s (poll every 3s)"
    );
  });

  it("normalizes published-port TCP readiness probes", () => {
    const probe = readComposeReadinessProbe({
      type: "tcp",
      target: "published-port",
      port: 5432
    });

    expect(probe).toEqual({
      type: "tcp",
      target: "published-port",
      host: "127.0.0.1",
      port: 5432,
      timeoutSeconds: 60,
      intervalSeconds: 3
    });
    expect(buildComposeReadinessProbeUrl(probe!)).toBe("tcp://127.0.0.1:5432");
    expect(describeComposeReadinessProbe(probe!)).toBe(
      "TCP readiness on published endpoint tcp://127.0.0.1:5432 within 60s (poll every 3s)"
    );
  });

  it("captures service-scoped snapshots for internal-network probes", () => {
    const probe = readComposeReadinessProbe({
      type: "tcp",
      target: "internal-network",
      port: 5432
    });

    const snapshot = snapshotComposeReadinessProbe({
      probe: probe!,
      serviceName: "db"
    });

    expect(snapshot).toEqual({
      type: "tcp",
      target: "internal-network",
      port: 5432,
      timeoutSeconds: 60,
      intervalSeconds: 3,
      serviceName: "db"
    });
    expect(buildComposeReadinessProbeUrl(snapshot, snapshot.serviceName)).toBe("tcp://db:5432");
  });
});
