import { describe, expect, test } from "vitest";

describe("port-conflict-detection", () => {
  test("parses CONFLICT lines correctly", () => {
    const stdout = [
      'CONFLICT:80:tcp:users:(("nginx",pid=1234,fd=6))',
      'CONFLICT:443:tcp:users:(("nginx",pid=1234,fd=7))',
      "CONFLICT:5432:tcp:users:((postgres,pid=567,fd=3))"
    ];

    const conflicts = [];
    for (const line of stdout) {
      if (!line.startsWith("CONFLICT:")) continue;
      const parts = line.split(":");
      const port = parseInt(parts[1] ?? "", 10);
      const protocol = parts[2] === "udp" ? ("udp" as const) : ("tcp" as const);
      const occupiedBy = parts.slice(3).join(":").trim() || "unknown";
      if (Number.isFinite(port)) {
        conflicts.push({ port, protocol, occupiedBy });
      }
    }

    expect(conflicts).toHaveLength(3);
    expect(conflicts[0]).toEqual({
      port: 80,
      protocol: "tcp",
      occupiedBy: 'users:(("nginx",pid=1234,fd=6))'
    });
    expect(conflicts[2]?.port).toBe(5432);
  });

  test("handles empty output (no conflicts)", () => {
    const stdout: string[] = [];
    const conflicts = stdout.filter((l) => l.startsWith("CONFLICT:"));
    expect(conflicts).toHaveLength(0);
  });
});
