import { describe, expect, it } from "vitest";
import {
  collectContainerRegistryHostsFromImageReferences,
  normalizeContainerRegistryHost,
  resolveContainerRegistryHostFromImageReference
} from "./container-registries-shared";

describe("normalizeContainerRegistryHost", () => {
  it("normalizes Docker Hub aliases to docker.io", () => {
    expect(normalizeContainerRegistryHost("https://index.docker.io")).toBe("docker.io");
    expect(normalizeContainerRegistryHost("registry-1.docker.io")).toBe("docker.io");
  });

  it("rejects path-shaped values", () => {
    expect(() => normalizeContainerRegistryHost("ghcr.io/org/app")).toThrow(
      "Registry host must be a hostname like ghcr.io or docker.io."
    );
  });
});

describe("resolveContainerRegistryHostFromImageReference", () => {
  it("uses docker.io when the image omits an explicit registry", () => {
    expect(resolveContainerRegistryHostFromImageReference("redis:7")).toBe("docker.io");
    expect(resolveContainerRegistryHostFromImageReference("library/nginx:latest")).toBe(
      "docker.io"
    );
  });

  it("extracts explicit registries from image references", () => {
    expect(resolveContainerRegistryHostFromImageReference("ghcr.io/acme/api:latest")).toBe(
      "ghcr.io"
    );
    expect(resolveContainerRegistryHostFromImageReference("localhost:5000/app@sha256:abc")).toBe(
      "localhost:5000"
    );
  });
});

describe("collectContainerRegistryHostsFromImageReferences", () => {
  it("deduplicates normalized registry hosts", () => {
    expect(
      collectContainerRegistryHostsFromImageReferences([
        "ghcr.io/acme/api:latest",
        "index.docker.io/library/nginx:latest",
        "redis:7",
        "ghcr.io/acme/worker:latest",
        "",
        null
      ])
    ).toEqual(["ghcr.io", "docker.io"]);
  });
});
