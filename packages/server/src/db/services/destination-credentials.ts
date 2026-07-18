import {
  decryptWithKeyMaterial,
  encryptWithKeyMaterial,
  getEncryptionKeyId,
  resolveEncryptionKeyMaterial
} from "../crypto";

export const DESTINATION_CREDENTIAL_ENVELOPE_VERSION = 1 as const;

export const DESTINATION_CREDENTIAL_FIELDS = [
  "accessKey",
  "secretAccessKey",
  "oauthToken",
  "rcloneConfig",
  "encryptionPassword",
  "encryptionSalt"
] as const;

export type DestinationCredentialField = (typeof DESTINATION_CREDENTIAL_FIELDS)[number];

export type DestinationCredentials = Partial<Record<DestinationCredentialField, string>>;

export type DestinationCredentialsInput = Partial<
  Record<DestinationCredentialField, string | null | undefined>
>;

export interface DestinationCredentialEnvelopeV1 extends DestinationCredentials {
  version: typeof DESTINATION_CREDENTIAL_ENVELOPE_VERSION;
}

export interface DestinationCredentialEncryptedFields {
  credentialsEncrypted: string | null;
  credentialEnvelopeVersion: number | null;
  credentialKeyId: string | null;
}

export interface EncryptedDestinationCredentials extends DestinationCredentialEncryptedFields {
  credentialsEncrypted: string;
  credentialEnvelopeVersion: typeof DESTINATION_CREDENTIAL_ENVELOPE_VERSION;
  credentialKeyId: string;
}

export type LegacyDestinationCredentialFields = Partial<
  Record<DestinationCredentialField, string | null | undefined>
>;

function resolveExplicitDestinationCredentialKeyMaterial(
  keyMaterial: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const normalized = keyMaterial.trim();
  if (!normalized) {
    throw new Error("Destination credential key material must not be empty.");
  }

  return resolveEncryptionKeyMaterial({ ...env, ENCRYPTION_KEY: normalized });
}

export function resolveDestinationCredentialKeyMaterial(
  env: NodeJS.ProcessEnv = process.env
): string {
  const destinationKey = env.DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY;
  return destinationKey
    ? resolveExplicitDestinationCredentialKeyMaterial(destinationKey, env)
    : resolveEncryptionKeyMaterial(env);
}

export function resolvePreviousDestinationCredentialKeyMaterial(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const previousKey = env.DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY;
  return previousKey ? resolveExplicitDestinationCredentialKeyMaterial(previousKey, env) : null;
}

function resolveCredentialKeyMaterial(keyMaterial?: string): string {
  return keyMaterial === undefined
    ? resolveDestinationCredentialKeyMaterial()
    : resolveExplicitDestinationCredentialKeyMaterial(keyMaterial);
}

function normalizeCredentialValue(
  field: DestinationCredentialField,
  value: string | null | undefined
): string | undefined {
  if (value === undefined || value === null || value.length === 0) {
    return undefined;
  }

  return field === "oauthToken" ? normalizeDestinationOauthToken(value) : value;
}

export function normalizeDestinationOauthToken(
  oauthToken: string | null | undefined
): string | undefined {
  if (oauthToken === undefined || oauthToken === null || oauthToken.length === 0) {
    return undefined;
  }

  try {
    return JSON.stringify(JSON.parse(oauthToken));
  } catch {
    throw new Error("Invalid OAuth token: must be valid JSON from 'rclone authorize'.");
  }
}

export function normalizeDestinationCredentials(
  credentials: DestinationCredentialsInput
): DestinationCredentials {
  const normalized: DestinationCredentials = {};

  for (const field of DESTINATION_CREDENTIAL_FIELDS) {
    const value = normalizeCredentialValue(field, credentials[field]);
    if (value !== undefined) {
      normalized[field] = value;
    }
  }

  return normalized;
}

export function redactDestinationCredentialValues(
  text: string,
  credentials: DestinationCredentialsInput
): string {
  const nestedValues: string[] = [];
  const normalized = normalizeDestinationCredentials(credentials);
  if (normalized.oauthToken) {
    try {
      const visit = (value: unknown): void => {
        if (typeof value === "string") {
          nestedValues.push(value);
        } else if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (value && typeof value === "object") {
          Object.values(value).forEach(visit);
        }
      };
      visit(JSON.parse(normalized.oauthToken));
    } catch {
      // OAuth tokens are validated before storage; keep whole-value redaction as the fallback.
    }
  }
  if (normalized.rcloneConfig) {
    for (const line of normalized.rcloneConfig.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator >= 0) {
        nestedValues.push(line.slice(separator + 1).trim());
      }
    }
  }
  const secretValues = [
    ...new Set(
      [...Object.values(normalized), ...nestedValues].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    )
  ].sort((left, right) => right.length - left.length);

  if (secretValues.length === 0) return text;

  const escapedSecretValues = secretValues.map((secretValue) =>
    secretValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return text.replace(new RegExp(escapedSecretValues.join("|"), "g"), "[redacted]");
}

export function getDestinationCredentialKeyId(keyMaterial?: string): string {
  return getEncryptionKeyId(resolveCredentialKeyMaterial(keyMaterial));
}

export function encryptDestinationCredentials(
  credentials: DestinationCredentialsInput,
  keyMaterial?: string
): EncryptedDestinationCredentials {
  const resolvedKeyMaterial = resolveCredentialKeyMaterial(keyMaterial);
  const normalized = normalizeDestinationCredentials(credentials);
  const envelope: DestinationCredentialEnvelopeV1 = {
    version: DESTINATION_CREDENTIAL_ENVELOPE_VERSION,
    ...normalized
  };

  return {
    credentialsEncrypted: encryptWithKeyMaterial(JSON.stringify(envelope), resolvedKeyMaterial),
    credentialEnvelopeVersion: DESTINATION_CREDENTIAL_ENVELOPE_VERSION,
    credentialKeyId: getDestinationCredentialKeyId(resolvedKeyMaterial)
  };
}

export function hasLegacyDestinationCredentials(row: LegacyDestinationCredentialFields): boolean {
  return DESTINATION_CREDENTIAL_FIELDS.some(
    (field) => row[field] !== null && row[field] !== undefined
  );
}

export function hasEncryptedDestinationCredentials(
  row: DestinationCredentialEncryptedFields
): boolean {
  return Boolean(row.credentialsEncrypted);
}

export function getLegacyDestinationCredentials(
  row: LegacyDestinationCredentialFields
): DestinationCredentials {
  return normalizeDestinationCredentials(row);
}

export function decryptDestinationCredentials(
  rowOrEncryptedFields: DestinationCredentialEncryptedFields,
  keyMaterial?: string
): DestinationCredentials {
  if (!rowOrEncryptedFields.credentialsEncrypted) {
    if (
      rowOrEncryptedFields.credentialEnvelopeVersion !== null ||
      rowOrEncryptedFields.credentialKeyId !== null
    ) {
      throw new Error("Destination credential envelope metadata is incomplete.");
    }
    return {};
  }

  if (rowOrEncryptedFields.credentialEnvelopeVersion !== DESTINATION_CREDENTIAL_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported destination credential envelope version: ${String(rowOrEncryptedFields.credentialEnvelopeVersion)}.`
    );
  }

  const resolvedKeyMaterial = resolveCredentialKeyMaterial(keyMaterial);
  const expectedKeyId = getDestinationCredentialKeyId(resolvedKeyMaterial);
  if (!rowOrEncryptedFields.credentialKeyId) {
    throw new Error("Destination credential envelope is missing its encryption key identifier.");
  }
  if (rowOrEncryptedFields.credentialKeyId !== expectedKeyId) {
    throw new Error(
      "Destination credential envelope was encrypted with a different key. Configure the matching key or complete key rotation before using this destination."
    );
  }

  const decryptedPayload = decryptWithKeyMaterial(
    rowOrEncryptedFields.credentialsEncrypted,
    resolvedKeyMaterial
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptedPayload);
  } catch {
    throw new Error("Destination credential envelope payload is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Destination credential envelope payload is invalid.");
  }
  const envelope = parsed as Partial<DestinationCredentialEnvelopeV1>;
  if (envelope.version !== DESTINATION_CREDENTIAL_ENVELOPE_VERSION) {
    throw new Error("Destination credential envelope payload version does not match its metadata.");
  }

  const credentialInput: DestinationCredentialsInput = {};
  for (const field of DESTINATION_CREDENTIAL_FIELDS) {
    const value = envelope[field];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`Destination credential envelope contains an invalid ${field} value.`);
    }
    credentialInput[field] = value;
  }

  return normalizeDestinationCredentials(credentialInput);
}

export function reencryptDestinationCredentials(
  rowOrEncryptedFields: DestinationCredentialEncryptedFields,
  oldKeyMaterial: string,
  newKeyMaterial: string
): EncryptedDestinationCredentials {
  return encryptDestinationCredentials(
    decryptDestinationCredentials(rowOrEncryptedFields, oldKeyMaterial),
    newKeyMaterial
  );
}
