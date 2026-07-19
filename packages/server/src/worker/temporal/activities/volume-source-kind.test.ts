import { describe, expect, it } from "vitest";
import { resolveVolumeSourceKind } from "./volume-source-kind";

describe("volume source kind", () => {
  it("treats only an explicit bind driver as a host bind mount", () => {
    expect(resolveVolumeSourceKind({ driver: "bind" })).toBe("bind-mount");
    expect(resolveVolumeSourceKind({ driver: " BIND " })).toBe("bind-mount");
  });

  it("defaults registered volumes to Docker named volumes", () => {
    expect(resolveVolumeSourceKind({ driver: "local" })).toBe("docker-volume");
    expect(resolveVolumeSourceKind({})).toBe("docker-volume");
    expect(resolveVolumeSourceKind(null)).toBe("docker-volume");
  });
});
