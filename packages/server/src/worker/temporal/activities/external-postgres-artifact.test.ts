import { describe, expect, it } from "vitest";
import {
  parseExternalPostgresArchiveListing,
  resolveOfficialPostgresVerifierImage
} from "./external-postgres-artifact";

const safeListing = `;
; Archive created at 2026-07-19 00:00:00 UTC
;     dbname: app
;     TOC Entries: 3
;     Format: Custom
;     Dumped from database version: 16.4
;     Dumped by pg_dump version: 16.4
;
1; 2615 2200 SCHEMA - public postgres
2; 1259 16384 TABLE public widgets postgres
3; 0 16384 TABLE DATA public widgets postgres
`;

describe("external PostgreSQL archive inspection", () => {
  it("persists sanitized listing evidence and validates the expected source major", () => {
    const parsed = parseExternalPostgresArchiveListing(safeListing, "16");
    expect(parsed.sourcePostgresVersion).toBe("16.4");
    expect(parsed.listingEvidence).toContain("Format: Custom");
    expect(parsed.listingEvidence).toContain("TABLE DATA");
  });

  it("accepts the vendor suffix and uppercase format emitted by official PostgreSQL images", () => {
    const officialListing = safeListing
      .replace("Format: Custom", "Format: CUSTOM")
      .replace(
        "Dumped from database version: 16.4",
        "Dumped from database version: 16.4 (Debian 16.4-1.pgdg120+1)"
      );

    expect(parseExternalPostgresArchiveListing(officialListing, "16").sourcePostgresVersion).toBe(
      "16.4"
    );
  });

  it("rejects invalid custom listings, mismatched majors, and unsafe archive entries", () => {
    expect(() =>
      parseExternalPostgresArchiveListing(safeListing.replace("Custom", "Tar"), "16")
    ).toThrow("not a PostgreSQL custom-format archive");
    expect(() => parseExternalPostgresArchiveListing(safeListing, "15")).toThrow("does not match");
    expect(() =>
      parseExternalPostgresArchiveListing(
        `${safeListing}4; 0 0 DATABASE - dangerous postgres\n`,
        "16"
      )
    ).toThrow("unsupported archive entry type: DATABASE");
  });

  it("resolves an immutable official image through a heartbeating cancellable runner", async () => {
    const calls: string[][] = [];
    let heartbeats = 0;
    const image = await resolveOfficialPostgresVerifierImage("16", {
      heartbeat: () => heartbeats++,
      runDocker: async (args, hooks) => {
        calls.push(args);
        hooks.heartbeat?.();
        return args[0] === "pull"
          ? ""
          : "docker.io/library/postgres@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
      }
    });
    expect(image).toBe(`postgres:16@sha256:${"a".repeat(64)}`);
    expect(calls.map((call) => call[0])).toEqual(["pull", "image"]);
    expect(heartbeats).toBeGreaterThan(0);
  });
});
