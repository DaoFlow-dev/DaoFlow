import {
  DOCKER_OWNERSHIP_LABEL_KEYS,
  buildDockerOwnershipLabels,
  type DockerOwnershipIdentity
} from "./docker-ownership";

type ComposeNode = Record<string, unknown>;

function isComposeNode(value: unknown): value is ComposeNode {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExternalResource(value: unknown): boolean {
  return isComposeNode(value) && Boolean(value.external);
}

function labelKey(value: string): string {
  return value.split("=", 1)[0] ?? "";
}

function mergeOwnershipLabels(
  value: unknown,
  ownership: ReturnType<typeof buildDockerOwnershipLabels>
): Record<string, unknown> | string[] {
  const requiredKeys = new Set<string>(DOCKER_OWNERSHIP_LABEL_KEYS);
  const ownershipEntries = Object.entries(ownership);

  if (Array.isArray(value)) {
    const preserved = value.filter(
      (label): label is string => typeof label === "string" && !requiredKeys.has(labelKey(label))
    );
    return [...preserved, ...ownershipEntries.map(([key, labelValue]) => `${key}=${labelValue}`)];
  }

  const labels = isComposeNode(value) ? { ...value } : {};
  for (const key of requiredKeys) {
    delete labels[key];
  }
  return { ...labels, ...ownership };
}

function ensureNode(parent: ComposeNode, key: string): ComposeNode {
  const current = parent[key];
  if (isComposeNode(current)) {
    return current;
  }
  const next: ComposeNode = {};
  parent[key] = next;
  return next;
}

function serviceUsesImplicitDefaultNetwork(service: ComposeNode): boolean {
  if (typeof service.network_mode === "string" && service.network_mode.trim().length > 0) {
    return false;
  }
  if (Array.isArray(service.networks)) {
    return service.networks.length === 0 || service.networks.includes("default");
  }
  if (isComposeNode(service.networks)) {
    return Object.keys(service.networks).length === 0 || "default" in service.networks;
  }
  return true;
}

function applyOwnershipToResources(
  doc: ComposeNode,
  resourceKey: "networks" | "volumes",
  ownership: ReturnType<typeof buildDockerOwnershipLabels>
): void {
  if (!isComposeNode(doc[resourceKey])) {
    return;
  }

  const resources = doc[resourceKey];
  for (const [name, value] of Object.entries(resources)) {
    if (isExternalResource(value)) {
      continue;
    }
    const resource = isComposeNode(value) ? value : {};
    resource.labels = mergeOwnershipLabels(resource.labels, ownership);
    resources[name] = resource;
  }
}

export function applyDockerOwnershipToComposeDoc(
  doc: ComposeNode,
  identity: DockerOwnershipIdentity
): void {
  const ownership = buildDockerOwnershipLabels(identity);
  const services = isComposeNode(doc.services) ? doc.services : {};
  let usesImplicitDefaultNetwork = false;

  for (const serviceValue of Object.values(services)) {
    if (!isComposeNode(serviceValue)) {
      continue;
    }
    const service = serviceValue;
    service.labels = mergeOwnershipLabels(service.labels, ownership);
    const deploy = ensureNode(service, "deploy");
    deploy.labels = mergeOwnershipLabels(deploy.labels, ownership);

    if (typeof service.build === "string") {
      service.build = { context: service.build };
    }
    if (isComposeNode(service.build)) {
      service.build.labels = mergeOwnershipLabels(service.build.labels, ownership);
    }
    usesImplicitDefaultNetwork ||= serviceUsesImplicitDefaultNetwork(service);
  }

  applyOwnershipToResources(doc, "networks", ownership);
  applyOwnershipToResources(doc, "volumes", ownership);

  if (!usesImplicitDefaultNetwork) {
    return;
  }

  const networks = ensureNode(doc, "networks");
  const defaultNetwork = networks.default;
  if (isExternalResource(defaultNetwork)) {
    return;
  }
  const network = isComposeNode(defaultNetwork) ? defaultNetwork : {};
  network.labels = mergeOwnershipLabels(network.labels, ownership);
  networks.default = network;
}
