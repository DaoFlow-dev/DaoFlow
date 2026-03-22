import type { DashboardExposureMode } from "./install-exposure-state";

const TRAEFIK_MODE = "traefik";
export const TRAEFIK_PROXY_NETWORK = "daoflow-proxy";
export const TRAEFIK_ACME_VOLUME = "traefik-letsencrypt";
const TRAEFIK_IMAGE = "traefik:v3.6.7";
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimOptional(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function buildTraefikLabels(): string[] {
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

export function buildTraefikService(): Record<string, unknown> {
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
