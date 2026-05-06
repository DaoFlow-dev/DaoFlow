import { readFileSync } from "node:fs";

export type RepositoryCredentialInput =
  | { kind: "https_token"; token: string; username?: string | null }
  | { kind: "https_basic"; username: string; password: string }
  | { kind: "ssh_key"; privateKey: string };

export interface RepositoryCredentialOptions {
  repoCredentialKind?: string;
  repoCredentialUsername?: string;
  repoCredentialToken?: string;
  repoCredentialTokenEnv?: string;
  repoCredentialTokenFile?: string;
  repoCredentialPassword?: string;
  repoCredentialPasswordEnv?: string;
  repoCredentialPasswordFile?: string;
  repoCredentialSshKey?: string;
  repoCredentialSshKeyEnv?: string;
  repoCredentialSshKeyFile?: string;
}

function readSecretOption(input: { value?: string; env?: string; file?: string }, label: string) {
  const sources = [input.value, input.env, input.file].filter(Boolean);
  if (sources.length === 0) {
    return undefined;
  }
  if (sources.length > 1) {
    throw new Error(`${label} must be provided by only one of direct value, env, or file.`);
  }
  if (input.env) {
    const value = process.env[input.env];
    if (!value) {
      throw new Error(`${label} env var ${input.env} is not set.`);
    }
    return value;
  }
  if (input.file) {
    return readFileSync(input.file, "utf8");
  }
  return input.value;
}

export function buildRepositoryCredential(
  opts: RepositoryCredentialOptions
): RepositoryCredentialInput | undefined {
  if (!opts.repoCredentialKind) {
    return undefined;
  }

  if (opts.repoCredentialKind === "https-token") {
    const token = readSecretOption(
      {
        value: opts.repoCredentialToken,
        env: opts.repoCredentialTokenEnv,
        file: opts.repoCredentialTokenFile
      },
      "Repository token"
    );
    if (!token) throw new Error("Repository token is required for https-token credentials.");
    return {
      kind: "https_token",
      token,
      username: opts.repoCredentialUsername
    };
  }

  if (opts.repoCredentialKind === "https-basic") {
    const password = readSecretOption(
      {
        value: opts.repoCredentialPassword,
        env: opts.repoCredentialPasswordEnv,
        file: opts.repoCredentialPasswordFile
      },
      "Repository password"
    );
    if (!opts.repoCredentialUsername) {
      throw new Error("Repository username is required for https-basic credentials.");
    }
    if (!password) throw new Error("Repository password is required for https-basic credentials.");
    return {
      kind: "https_basic",
      username: opts.repoCredentialUsername,
      password
    };
  }

  if (opts.repoCredentialKind === "ssh-key") {
    const privateKey = readSecretOption(
      {
        value: opts.repoCredentialSshKey,
        env: opts.repoCredentialSshKeyEnv,
        file: opts.repoCredentialSshKeyFile
      },
      "Repository SSH key"
    );
    if (!privateKey) throw new Error("Repository SSH key is required for ssh-key credentials.");
    return {
      kind: "ssh_key",
      privateKey
    };
  }

  throw new Error("Repository credential kind must be https-token, https-basic, or ssh-key.");
}

export function summarizeRepositoryCredential(credential: RepositoryCredentialInput | undefined) {
  if (!credential) {
    return undefined;
  }
  return { kind: credential.kind };
}
