import { getErrorMessage } from "../command-helpers";
import {
  emitManualSsoInstructions,
  emitOpenedBrowserNotice,
  emitSigningIn,
  emitSsoTimeoutPrompt,
  emitSsoVerificationDetails,
  emitStartingSso,
  LoginCommandError
} from "./output";
import type { LoginRuntime } from "./runtime";
import {
  exchangeSsoCode,
  pollSsoCode,
  signInWithEmailPassword,
  startSsoFlow
} from "./identity-client";
import type { LoginAuthMode, LoginAuthResult } from "./types";

export interface LoginCommandOptions {
  token?: string;
  email?: string;
  password?: string;
  sso?: boolean;
}

function resolveRequestedLoginMode(opts: LoginCommandOptions): LoginAuthMode {
  const authModes = [
    Boolean(opts.token),
    Boolean(opts.email || opts.password),
    Boolean(opts.sso)
  ].filter(Boolean).length;

  if (authModes !== 1) {
    throw new LoginCommandError(
      "Choose exactly one auth mode: --token, --email/--password, or --sso.",
      "INVALID_AUTH_MODE"
    );
  }

  if (opts.token) {
    return "token";
  }

  if (opts.sso) {
    return "sso";
  }

  if (opts.email && opts.password) {
    return "email-password";
  }

  throw new LoginCommandError(
    "Provide --token, --email/--password, or --sso to authenticate.",
    "INVALID_AUTH_MODE"
  );
}

async function authenticateWithSso(input: {
  baseUrl: string;
  isJson: boolean;
  runtime: LoginRuntime;
}): Promise<LoginAuthResult> {
  emitStartingSso(input.isJson);

  try {
    const device = await startSsoFlow(input.baseUrl, input.runtime);
    const opened = input.runtime.tryOpenBrowser(device.verificationUri);

    emitSsoVerificationDetails(input.isJson, device);
    if (opened) {
      emitOpenedBrowserNotice(input.isJson);
      const exchangeCode = await pollSsoCode(
        input.baseUrl,
        device.requestId,
        device.userCode,
        device.pollToken,
        device.intervalSeconds,
        device.expiresAt,
        input.runtime
      );

      if (exchangeCode) {
        return {
          authMode: "sso",
          sessionToken: await exchangeSsoCode(
            input.baseUrl,
            device.requestId,
            device.userCode,
            exchangeCode,
            input.runtime
          )
        };
      }

      if (input.isJson) {
        throw new LoginCommandError(
          "Browser login was not approved in time; manual CLI code entry is required.",
          "SSO_MANUAL_CODE_REQUIRED",
          {
            verificationUri: device.verificationUri,
            userCode: device.userCode,
            requestId: device.requestId,
            expiresAt: device.expiresAt
          }
        );
      }

      emitSsoTimeoutPrompt();
      return {
        authMode: "sso",
        sessionToken: await exchangeSsoCode(
          input.baseUrl,
          device.requestId,
          device.userCode,
          await input.runtime.prompt("CLI code: "),
          input.runtime
        )
      };
    }

    if (input.isJson) {
      throw new LoginCommandError(
        "SSO requires manual browser completion because no browser could be opened automatically.",
        "SSO_MANUAL_CODE_REQUIRED",
        {
          verificationUri: device.verificationUri,
          userCode: device.userCode,
          requestId: device.requestId,
          expiresAt: device.expiresAt
        }
      );
    }

    emitManualSsoInstructions(device.verificationUri);
    return {
      authMode: "sso",
      sessionToken: await exchangeSsoCode(
        input.baseUrl,
        device.requestId,
        device.userCode,
        await input.runtime.prompt("Paste the one-time CLI code: "),
        input.runtime
      )
    };
  } catch (error) {
    if (error instanceof LoginCommandError) {
      throw error;
    }

    throw new LoginCommandError(`SSO login failed: ${getErrorMessage(error)}`, "AUTH_FAILED");
  }
}

async function authenticateWithEmailPassword(input: {
  baseUrl: string;
  email: string;
  password: string;
  isJson: boolean;
  runtime: LoginRuntime;
}): Promise<LoginAuthResult> {
  emitSigningIn(input.isJson);

  try {
    return {
      authMode: "email-password",
      sessionToken: await signInWithEmailPassword(
        input.baseUrl,
        input.email,
        input.password,
        input.runtime
      )
    };
  } catch (error) {
    if (error instanceof LoginCommandError) {
      throw error;
    }

    throw new LoginCommandError(`Sign-in failed: ${getErrorMessage(error)}`, "AUTH_FAILED");
  }
}

export async function authenticateForLogin(input: {
  baseUrl: string;
  opts: LoginCommandOptions;
  isJson: boolean;
  runtime: LoginRuntime;
}): Promise<LoginAuthResult> {
  const authMode = resolveRequestedLoginMode(input.opts);

  switch (authMode) {
    case "token":
      return { authMode, sessionToken: input.opts.token ?? "" };
    case "sso":
      return authenticateWithSso({
        baseUrl: input.baseUrl,
        isJson: input.isJson,
        runtime: input.runtime
      });
    case "email-password":
      return authenticateWithEmailPassword({
        baseUrl: input.baseUrl,
        email: input.opts.email ?? "",
        password: input.opts.password ?? "",
        isJson: input.isJson,
        runtime: input.runtime
      });
  }
}
