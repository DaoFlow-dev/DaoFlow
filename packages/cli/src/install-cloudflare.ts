const BASIC_HOSTNAME_PATTERN = /\./;

export const CLOUDFLARE_TUNNEL_TOKEN_ENV = "CLOUDFLARE_TUNNEL_TOKEN";
export const CLOUDFLARE_TUNNEL_ORIGIN = "http://daoflow:3000";
export const CLOUDFLARED_IMAGE = "cloudflare/cloudflared:latest";

function trimOptional(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function resolveCloudflareTunnelToken(input: {
  enabled: boolean;
  token?: string;
  existingEnv?: Record<string, string>;
}): string | undefined {
  if (!input.enabled) {
    return undefined;
  }

  return (
    trimOptional(input.token) ?? trimOptional(input.existingEnv?.[CLOUDFLARE_TUNNEL_TOKEN_ENV])
  );
}

export function getCloudflareTunnelConfigurationError(input: {
  enabled: boolean;
  domain: string;
  token?: string;
}): string | null {
  if (!input.enabled) {
    return null;
  }

  const hostname = normalizeHostname(input.domain);
  if (hostname === "localhost" || !BASIC_HOSTNAME_PATTERN.test(hostname)) {
    return "Cloudflare Tunnel requires a public domain like deploy.example.com.";
  }

  if (!trimOptional(input.token)) {
    return `A Cloudflare tunnel token is required when Cloudflare Tunnel is enabled (--cloudflare-tunnel-token or ${CLOUDFLARE_TUNNEL_TOKEN_ENV}).`;
  }

  return null;
}

export function getCloudflareTunnelDashboardUrl(domain: string): string {
  return `https://${normalizeHostname(domain)}`;
}

export function buildCloudflareTunnelGuide(input: { domain: string }): string[] {
  return [
    `In Cloudflare Zero Trust, open the named tunnel that matches the token and add a public hostname for ${normalizeHostname(input.domain)}.`,
    "Use service type HTTP.",
    `Use origin URL ${CLOUDFLARE_TUNNEL_ORIGIN}.`,
    "If you later change the public hostname, update BETTER_AUTH_URL in .env and run docker compose up -d."
  ];
}

export function buildCloudflareTunnelService(): Record<string, unknown> {
  return {
    image: CLOUDFLARED_IMAGE,
    restart: "unless-stopped",
    command: ["tunnel", "--no-autoupdate", "run"],
    environment: {
      TUNNEL_TOKEN: "${CLOUDFLARE_TUNNEL_TOKEN}"
    },
    depends_on: {
      daoflow: {
        condition: "service_started"
      }
    }
  };
}
