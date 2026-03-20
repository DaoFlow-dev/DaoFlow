import chalk from "chalk";
import type { DeviceStartResponse, LoginAuthMode } from "./types";

export class LoginCommandError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LoginCommandError";
  }
}

export function emitLoginError(isJson: boolean, error: LoginCommandError): void {
  if (isJson) {
    console.log(
      JSON.stringify({ ...(error.extra ?? {}), ok: false, error: error.message, code: error.code })
    );
    return;
  }

  console.error(chalk.red(`✗ ${error.message}`));
}

export function emitStartingSso(isJson: boolean): void {
  if (!isJson) {
    console.error(chalk.dim("Starting browser sign-in..."));
  }
}

export function emitSigningIn(isJson: boolean): void {
  if (!isJson) {
    console.error(chalk.dim("Signing in..."));
  }
}

export function emitSsoVerificationDetails(
  isJson: boolean,
  device: Pick<DeviceStartResponse, "verificationUri" | "userCode">
): void {
  if (isJson) {
    return;
  }

  console.error(chalk.dim(`Verification URL: ${device.verificationUri}`));
  console.error(chalk.dim(`User code: ${device.userCode}`));
}

export function emitOpenedBrowserNotice(isJson: boolean): void {
  if (!isJson) {
    console.error(
      chalk.dim(
        "Opened a browser window. If it did not appear, open the verification URL manually."
      )
    );
  }
}

export function emitSsoTimeoutPrompt(): void {
  console.error(
    chalk.yellow(
      "Browser login was not approved in time. Paste the one-time CLI code shown in the browser."
    )
  );
}

export function emitManualSsoInstructions(verificationUri: string): void {
  console.error(chalk.yellow("No browser could be opened automatically for SSO."));
  console.error(chalk.yellow(`Open this URL manually: ${verificationUri}`));
  console.error(
    chalk.dim(
      "After you approve the CLI session in the browser, paste the one-time CLI code shown on the page."
    )
  );
}

export function emitValidationSkipped(isJson: boolean): void {
  if (!isJson) {
    console.error(chalk.yellow("Could not validate credential live; saving anyway."));
  }
}

export function emitLoginSuccess(input: {
  isJson: boolean;
  apiUrl: string;
  context: string;
  authMode: LoginAuthMode;
  validated: boolean;
  authMethod: "session" | "api-token";
  principalEmail: string | null;
  role: string | null;
}): void {
  if (input.isJson) {
    console.log(
      JSON.stringify({
        ok: true,
        data: {
          apiUrl: input.apiUrl,
          context: input.context,
          authMode: input.authMode,
          validated: input.validated,
          authMethod: input.authMethod,
          principalEmail: input.principalEmail,
          role: input.role
        }
      })
    );
    return;
  }

  const identitySuffix =
    input.principalEmail && input.role
      ? ` (${input.principalEmail}, ${input.role}, ${input.authMethod})`
      : ` (${input.authMethod})`;
  console.log(
    chalk.green(`Logged in to ${input.apiUrl} as context "${input.context}"${identitySuffix}`)
  );
}
