const API_TOKEN_PREFIX = "dfl_";

/** Generate a random DaoFlow API token value. */
export function generateApiTokenValue(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = API_TOKEN_PREFIX;

  for (let index = 0; index < 48; index += 1) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return token;
}

/** Hash a token for storage with deterministic SHA-256 output. */
export async function hashApiToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isApiTokenValue(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}

export function parseBearerApiToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token, ...rest] = headerValue.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0 || !isApiTokenValue(token)) {
    return null;
  }

  return token;
}
