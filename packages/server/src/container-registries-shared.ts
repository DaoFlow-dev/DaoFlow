export interface ContainerRegistrySummary {
  id: string;
  name: string;
  registryHost: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContainerRegistryCredential {
  id: string;
  registryHost: string;
  username: string;
  password: string;
}

const DOCKER_HUB_HOSTS = new Set(["docker.io", "index.docker.io", "registry-1.docker.io"]);

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export function normalizeContainerRegistryHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Registry host is required.");
  }

  let host = trimmed;
  if (trimmed.includes("://")) {
    try {
      host = new URL(trimmed).host;
    } catch {
      throw new Error("Registry host must be a hostname like ghcr.io or docker.io.");
    }
  }

  host = trimSlashes(host.toLowerCase());
  if (!host || host.includes("/")) {
    throw new Error("Registry host must be a hostname like ghcr.io or docker.io.");
  }

  return DOCKER_HUB_HOSTS.has(host) ? "docker.io" : host;
}

export function resolveContainerRegistryHostFromImageReference(imageReference: string): string {
  const trimmed = imageReference.trim();
  if (!trimmed) {
    return "docker.io";
  }

  const withoutDigest = trimmed.split("@")[0] ?? trimmed;
  const segments = withoutDigest.split("/");
  const firstSegment = segments[0] ?? "";
  const hasExplicitRegistry =
    segments.length > 1 &&
    (firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost");

  return hasExplicitRegistry ? normalizeContainerRegistryHost(firstSegment) : "docker.io";
}

export function collectContainerRegistryHostsFromImageReferences(
  imageReferences: Iterable<string | null | undefined>
): string[] {
  const hosts = new Set<string>();

  for (const imageReference of imageReferences) {
    if (!imageReference?.trim()) {
      continue;
    }

    hosts.add(resolveContainerRegistryHostFromImageReference(imageReference));
  }

  return [...hosts];
}
