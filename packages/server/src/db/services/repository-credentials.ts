import { and, desc, eq } from "drizzle-orm";
import { encrypt, decrypt } from "../crypto";
import { db } from "../connection";
import { repositoryCredentials } from "../schema/projects";
import { newId } from "./json-helpers";

export type RepositoryCredentialInput =
  | {
      kind: "https_token";
      token: string;
      username?: string | null;
    }
  | {
      kind: "https_basic";
      username: string;
      password: string;
    }
  | {
      kind: "ssh_key";
      privateKey: string;
    };

export type ResolvedRepositoryCredential =
  | {
      kind: "https_token";
      token: string;
      username: string | null;
    }
  | {
      kind: "https_basic";
      username: string;
      password: string;
    }
  | {
      kind: "ssh_key";
      privateKey: string;
    };

function trimSecret(value: string) {
  return value.trim();
}

function encryptOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? encrypt(trimmed) : null;
}

export function sanitizeRepositoryCredentialInput(
  input: RepositoryCredentialInput | null | undefined
) {
  if (!input) return null;

  if (input.kind === "https_token") {
    return {
      kind: input.kind,
      username: input.username?.trim() || null,
      hasToken: trimSecret(input.token).length > 0
    };
  }

  if (input.kind === "https_basic") {
    return {
      kind: input.kind,
      username: input.username.trim(),
      hasPassword: trimSecret(input.password).length > 0
    };
  }

  return {
    kind: input.kind,
    hasPrivateKey: trimSecret(input.privateKey).length > 0
  };
}

export async function replaceProjectRepositoryCredential(input: {
  projectId: string;
  credential: RepositoryCredentialInput | null | undefined;
}) {
  await db
    .update(repositoryCredentials)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(
      and(
        eq(repositoryCredentials.projectId, input.projectId),
        eq(repositoryCredentials.status, "active")
      )
    );

  if (!input.credential) {
    return null;
  }

  const now = new Date();
  const values = {
    id: newId(),
    projectId: input.projectId,
    kind: input.credential.kind,
    usernameEncrypted: null as string | null,
    passwordEncrypted: null as string | null,
    tokenEncrypted: null as string | null,
    privateKeyEncrypted: null as string | null,
    status: "active",
    updatedAt: now
  };

  if (input.credential.kind === "https_token") {
    values.usernameEncrypted = encryptOptional(input.credential.username);
    values.tokenEncrypted = encrypt(trimSecret(input.credential.token));
  } else if (input.credential.kind === "https_basic") {
    values.usernameEncrypted = encrypt(trimSecret(input.credential.username));
    values.passwordEncrypted = encrypt(trimSecret(input.credential.password));
  } else {
    values.privateKeyEncrypted = encrypt(trimSecret(input.credential.privateKey));
  }

  const [credential] = await db.insert(repositoryCredentials).values(values).returning();
  return credential ?? null;
}

export async function resolveActiveProjectRepositoryCredential(
  projectId: string | null | undefined
): Promise<ResolvedRepositoryCredential | null> {
  if (!projectId) {
    return null;
  }

  const [credential] = await db
    .select()
    .from(repositoryCredentials)
    .where(
      and(
        eq(repositoryCredentials.projectId, projectId),
        eq(repositoryCredentials.status, "active")
      )
    )
    .orderBy(desc(repositoryCredentials.updatedAt))
    .limit(1);
  if (!credential) {
    return null;
  }

  if (credential.kind === "https_token" && credential.tokenEncrypted) {
    return {
      kind: "https_token",
      token: decrypt(credential.tokenEncrypted),
      username: credential.usernameEncrypted ? decrypt(credential.usernameEncrypted) : null
    };
  }

  if (
    credential.kind === "https_basic" &&
    credential.usernameEncrypted &&
    credential.passwordEncrypted
  ) {
    return {
      kind: "https_basic",
      username: decrypt(credential.usernameEncrypted),
      password: decrypt(credential.passwordEncrypted)
    };
  }

  if (credential.kind === "ssh_key" && credential.privateKeyEncrypted) {
    return {
      kind: "ssh_key",
      privateKey: decrypt(credential.privateKeyEncrypted)
    };
  }

  return null;
}
