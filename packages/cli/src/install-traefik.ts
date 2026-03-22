import { writeFileSync } from "node:fs";
import { isMap, parseDocument } from "yaml";
import type { Document, YAMLMap } from "yaml";
import type { DashboardExposureMode } from "./install-exposure-state";
import type { InstallerRuntime } from "./installer-lifecycle";

const TRAEFIK_MODE = "traefik";
const TRAEFIK_PROXY_NETWORK = "daoflow-proxy";
const TRAEFIK_ACME_VOLUME = "traefik-letsencrypt";
const LOCAL_DASHBOARD_BIND = "127.0.0.1:${DAOFLOW_PORT:-3000}:3000";
const TRAEFIK_IMAGE = "traefik:v3.6.7";
const TRAEFIK_MANAGED_LABEL_PREFIX = "traefik.";
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type JsonRecord = Record<string, unknown>;
type MutableYamlMap = YAMLMap<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function trimOptional(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
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

function buildTraefikLabels(): string[] {
  return [
    "traefik.enable=true",
    "traefik.docker.network=${DAOFLOW_PROXY_NETWORK:-daoflow-proxy}",
    "traefik.http.routers.daoflow.rule=Host(`${DAOFLOW_DOMAIN}`)",
    "traefik.http.routers.daoflow.entrypoints=websecure",
    "traefik.http.routers.daoflow.tls=true",
    "traefik.http.routers.daoflow.tls.certresolver=letsencrypt",
    "traefik.http.services.daoflow.loadbalancer.server.port=3000"
  ];
}

function buildTraefikService(): JsonRecord {
  return {
    image: TRAEFIK_IMAGE,
    restart: "unless-stopped",
    ports: ["80:80", "443:443"],
    command: [
      "--providers.docker=true",
      "--providers.docker.exposedbydefault=false",
      "--entrypoints.web.address=:80",
      "--entrypoints.websecure.address=:443",
      "--entrypoints.web.http.redirections.entrypoint.to=websecure",
      "--entrypoints.web.http.redirections.entrypoint.scheme=https",
      "--certificatesresolvers.letsencrypt.acme.email=${DAOFLOW_ACME_EMAIL}",
      "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json",
      "--certificatesresolvers.letsencrypt.acme.httpchallenge=true",
      "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ],
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock:ro",
      `${TRAEFIK_ACME_VOLUME}:/letsencrypt`
    ],
    networks: [TRAEFIK_PROXY_NETWORK],
    depends_on: {
      daoflow: {
        condition: "service_started"
      }
    }
  };
}

export function isTraefikExposureMode(mode: DashboardExposureMode): mode is "traefik" {
  return mode === TRAEFIK_MODE;
}

export function resolveTraefikAcmeEmail(input: {
  exposureMode: DashboardExposureMode;
  acmeEmail?: string;
  adminEmail?: string;
  existingEnv?: Record<string, string>;
}): string | undefined {
  if (!isTraefikExposureMode(input.exposureMode)) {
    return undefined;
  }

  return (
    trimOptional(input.acmeEmail) ??
    trimOptional(input.existingEnv?.DAOFLOW_ACME_EMAIL) ??
    trimOptional(input.adminEmail)
  );
}

export function getTraefikConfigurationError(input: {
  exposureMode: DashboardExposureMode;
  domain: string;
  port: number;
  acmeEmail?: string;
}): string | null {
  if (!isTraefikExposureMode(input.exposureMode)) {
    return null;
  }

  const hostname = normalizeHostname(input.domain);
  if (hostname === "localhost" || !hostname.includes(".")) {
    return "Traefik install requires a public domain like deploy.example.com.";
  }

  if (input.port === 80 || input.port === 443) {
    return "When Traefik is enabled, choose a local DaoFlow port other than 80 or 443.";
  }

  const acmeEmail = trimOptional(input.acmeEmail);
  if (!acmeEmail || !BASIC_EMAIL_PATTERN.test(acmeEmail)) {
    return "A valid Let's Encrypt email is required when Traefik is enabled.";
  }

  return null;
}

export function getTraefikDashboardUrl(domain: string): string {
  return `https://${normalizeHostname(domain)}`;
}

export function buildInstallComposeContent(input: {
  composeContent: string;
  exposureMode: DashboardExposureMode;
}): string {
  if (!isTraefikExposureMode(input.exposureMode)) {
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
  daoflow.set("networks", unique([...existingNetworks, TRAEFIK_PROXY_NETWORK]));
  daoflow.set("labels", [...existingLabels, ...buildTraefikLabels()]);

  services.set("traefik", buildTraefikService());

  const networks = ensureMapNode(doc, "networks", doc.get("networks", true));
  networks.set(TRAEFIK_PROXY_NETWORK, {
    name: "${DAOFLOW_PROXY_NETWORK:-daoflow-proxy}"
  });

  const volumes = ensureMapNode(doc, "volumes", doc.get("volumes", true));
  volumes.set(TRAEFIK_ACME_VOLUME, {});

  return String(doc);
}

export async function writeInstallComposeFile(input: {
  runtime: InstallerRuntime;
  composePath: string;
  exposureMode: DashboardExposureMode;
}): Promise<void> {
  const composeContent = await input.runtime.fetchComposeYml();
  writeFileSync(
    input.composePath,
    buildInstallComposeContent({
      composeContent,
      exposureMode: input.exposureMode
    })
  );
}
