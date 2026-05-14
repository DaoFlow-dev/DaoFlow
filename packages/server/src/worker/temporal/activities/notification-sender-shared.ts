export const SEVERITY_COLORS: Record<string, string> = {
  info: "#2196F3",
  success: "#4CAF50",
  warning: "#FF9800",
  error: "#F44336"
};

export const SEVERITY_EMOJI: Record<string, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "🚨"
};

export const DISCORD_COLORS: Record<string, number> = {
  info: 0x2196f3,
  success: 0x4caf50,
  warning: 0xff9800,
  error: 0xf44336
};

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
  "169.254.169.254"
]);

export function validateWebhookUrl(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname)) {
    return { ok: false, reason: `Blocked host: ${hostname}` };
  }

  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
    return { ok: false, reason: "RFC 1918 private IP addresses are not allowed" };
  }

  return { ok: true };
}
