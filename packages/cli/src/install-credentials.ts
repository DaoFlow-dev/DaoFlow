import type { InstallOptions } from "./install-config";

export const INITIAL_ADMIN_EMAIL_ENV = "DAOFLOW_INITIAL_ADMIN_EMAIL";
export const INITIAL_ADMIN_PASSWORD_ENV = "DAOFLOW_INITIAL_ADMIN_PASSWORD";

type InitialAdminCredentialSource = "none" | "flags" | "env" | "mixed";

export function resolveInitialAdminCredentials(
  options: Pick<InstallOptions, "email" | "password">,
  env: NodeJS.ProcessEnv = process.env
): {
  email: string | undefined;
  password: string | undefined;
  source: InitialAdminCredentialSource;
} {
  const optionEmail = options.email?.trim() || undefined;
  const optionPassword = options.password?.trim() || undefined;
  const envEmail = env[INITIAL_ADMIN_EMAIL_ENV]?.trim() || undefined;
  const envPassword = env[INITIAL_ADMIN_PASSWORD_ENV]?.trim() || undefined;
  const emailFromEnv = !optionEmail && !!envEmail;
  const passwordFromEnv = !optionPassword && !!envPassword;

  let source: InitialAdminCredentialSource = "none";
  if (optionEmail || optionPassword) {
    source = emailFromEnv || passwordFromEnv ? "mixed" : "flags";
  } else if (envEmail || envPassword) {
    source = "env";
  }

  return {
    email: optionEmail ?? envEmail,
    password: optionPassword ?? envPassword,
    source
  };
}
