import { writeFileSync } from "node:fs";
import { isMap, parseDocument } from "yaml";
import type { Document, YAMLMap } from "yaml";
import { buildCloudflareTunnelService } from "./install-cloudflare";
import type { DashboardExposureMode } from "./install-exposure-state";
import type { InstallerRuntime } from "./installer-lifecycle";
import {
  buildTraefikLabels,
  buildTraefikService,
  isTraefikExposureMode,
  TRAEFIK_ACME_VOLUME,
  TRAEFIK_PROXY_NETWORK
} from "./install-traefik";

const DEFAULT_COMPOSE_NETWORK = "default";
const LOCAL_DASHBOARD_BIND = "127.0.0.1:${DAOFLOW_PORT:-3000}:3000";
const TRAEFIK_MANAGED_LABEL_PREFIX = "traefik.";

type JsonRecord = Record<string, unknown>;
type MutableYamlMap = YAMLMap<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  const record = asRecord(value);
  return Object.entries(record).flatMap(([key, entryValue]) =>
    typeof entryValue === "string" ||
    typeof entryValue === "number" ||
    typeof entryValue === "boolean"
      ? [`${key}=${String(entryValue)}`]
      : []
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function ensureMapNode(doc: Document.Parsed, key: string, currentValue: unknown): MutableYamlMap {
  if (isMap(currentValue)) {
    return currentValue as MutableYamlMap;
  }

  const nextValue = doc.createNode({});
  if (!isMap(nextValue)) {
    throw new Error(`Could not create YAML map node for "${key}".`);
  }

  doc.set(key, nextValue);
  return nextValue as MutableYamlMap;
}

function ensureChildMapNode(
  doc: Document.Parsed,
  parent: MutableYamlMap,
  key: string,
  currentValue: unknown
): MutableYamlMap {
  if (isMap(currentValue)) {
    return currentValue as MutableYamlMap;
  }

  const nextValue = doc.createNode({});
  if (!isMap(nextValue)) {
    throw new Error(`Could not create YAML child map node for "${key}".`);
  }

  parent.set(key, nextValue);
  return nextValue as MutableYamlMap;
}

export function buildInstallComposeContent(input: {
  composeContent: string;
  exposureMode: DashboardExposureMode;
  cloudflareTunnelEnabled?: boolean;
}): string {
  if (!isTraefikExposureMode(input.exposureMode) && !input.cloudflareTunnelEnabled) {
    return input.composeContent;
  }

  const doc = parseDocument(input.composeContent);
  const services = ensureMapNode(doc, "services", doc.get("services", true));
  const daoflow = ensureChildMapNode(doc, services, "daoflow", services.get("daoflow", true));

  const daoflowObject = asRecord(daoflow.toJSON());
  const existingNetworks = toStringList(daoflowObject.networks).filter(Boolean);
  const existingLabels = toStringList(daoflowObject.labels).filter(
    (label) => !label.startsWith(TRAEFIK_MANAGED_LABEL_PREFIX)
  );

  daoflow.set("ports", [LOCAL_DASHBOARD_BIND]);

  if (isTraefikExposureMode(input.exposureMode)) {
    daoflow.set(
      "networks",
      unique([...existingNetworks, DEFAULT_COMPOSE_NETWORK, TRAEFIK_PROXY_NETWORK])
    );
    daoflow.set("labels", [...existingLabels, ...buildTraefikLabels()]);

    services.set("traefik", buildTraefikService());

    const networks = ensureMapNode(doc, "networks", doc.get("networks", true));
    networks.set(TRAEFIK_PROXY_NETWORK, {
      name: "${DAOFLOW_PROXY_NETWORK:-daoflow-proxy}"
    });

    const volumes = ensureMapNode(doc, "volumes", doc.get("volumes", true));
    volumes.set(TRAEFIK_ACME_VOLUME, {});
  }

  if (input.cloudflareTunnelEnabled) {
    services.set("cloudflared", buildCloudflareTunnelService());
  }

  return String(doc);
}

export async function writeInstallComposeFile(input: {
  runtime: InstallerRuntime;
  composePath: string;
  exposureMode: DashboardExposureMode;
  cloudflareTunnelEnabled?: boolean;
}): Promise<void> {
  const composeContent = await input.runtime.fetchComposeYml();
  writeFileSync(
    input.composePath,
    buildInstallComposeContent({
      composeContent,
      exposureMode: input.exposureMode,
      cloudflareTunnelEnabled: input.cloudflareTunnelEnabled
    })
  );
}
