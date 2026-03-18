function isApiTokenValue(token: string): boolean {
  return token.startsWith("dfl_");
}

export function buildAuthHeaders(
  token: string,
  extra?: Record<string, string>
): Record<string, string> {
  const authHeaders: Record<string, string> = isApiTokenValue(token)
    ? { Authorization: `Bearer ${token}` }
    : { Cookie: `better-auth.session_token=${token}` };

  return {
    ...authHeaders,
    ...(extra ?? {})
  };
}
