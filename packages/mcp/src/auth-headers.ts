/**
 * Build the auth headers for an API call.
 *
 * DaoFlow API tokens (prefixed `dfl_`) are sent as Bearer auth; Better Auth
 * session tokens are sent as a session cookie. Mirrors the CLI behaviour.
 */
function isApiTokenValue(token: string): boolean {
  return token.startsWith("dfl_");
}

export function buildAuthHeaders(token: string): Record<string, string> {
  if (isApiTokenValue(token)) {
    return { Authorization: `Bearer ${token}` };
  }

  return {
    Cookie: [
      `better-auth.session_token=${token}`,
      `__Secure-better-auth.session_token=${token}`
    ].join("; ")
  };
}
