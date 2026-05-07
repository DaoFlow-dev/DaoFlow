const MIN_PRODUCTION_AUTH_SECRET_LENGTH = 32;

export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const authSecret = env.BETTER_AUTH_SECRET?.trim();
  if (authSecret) {
    if (env.NODE_ENV === "production" && authSecret.length < MIN_PRODUCTION_AUTH_SECRET_LENGTH) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters in production.");
    }

    return authSecret;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set in production.");
  }

  return "daoflow-local-dev-secret-please-change-2026";
}
