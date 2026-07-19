export const DEFAULT_EXTERNAL_IMPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const MIN_EXTERNAL_IMPORT_BYTES = 1024 * 1024;
export const MAX_EXTERNAL_IMPORT_BYTES = DEFAULT_EXTERNAL_IMPORT_MAX_BYTES;

type ExistingExternalImportSettings = {
  externalImportEnabled: boolean;
  externalImportPrefix: string | null;
  maxExternalImportBytes: string;
  provider: string;
  encryptionMode: string;
};

type ExternalImportSettingsInput = {
  externalImportEnabled?: boolean;
  externalImportPrefix?: string | null;
  maxExternalImportBytes?: number | string | null;
  provider?: string;
  encryptionMode?: string;
};

export function normalizeExternalImportPrefix(value: string): string {
  const raw = value.trim();
  const trimmed = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (!trimmed || trimmed.length > 1024) {
    throw new Error("External import prefix must contain between 1 and 1024 characters.");
  }
  if (raw.endsWith("//")) {
    throw new Error("External import prefix must not contain empty path segments.");
  }
  if (trimmed.includes("\\") || hasControlCharacter(trimmed)) {
    throw new Error("External import prefix contains unsupported characters.");
  }

  const parts = trimmed.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("External import prefix must not contain empty or traversal path segments.");
  }

  return `${parts.join("/")}/`;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function normalizeExternalImportSettings(
  input: ExternalImportSettingsInput,
  existing?: ExistingExternalImportSettings
) {
  const externalImportEnabled =
    input.externalImportEnabled ?? existing?.externalImportEnabled ?? false;
  const rawPrefix =
    input.externalImportPrefix === undefined
      ? (existing?.externalImportPrefix ?? null)
      : input.externalImportPrefix;
  const externalImportPrefix = rawPrefix === null ? null : normalizeExternalImportPrefix(rawPrefix);
  const rawMax =
    input.maxExternalImportBytes === undefined
      ? (existing?.maxExternalImportBytes ?? DEFAULT_EXTERNAL_IMPORT_MAX_BYTES)
      : input.maxExternalImportBytes;
  const maxExternalImportBytes = normalizeExternalImportBytes(rawMax);

  if (externalImportEnabled && !externalImportPrefix) {
    throw new Error("External imports require a non-empty approved object prefix.");
  }
  const provider = input.provider ?? existing?.provider;
  const encryptionMode = input.encryptionMode ?? existing?.encryptionMode ?? "none";
  if (externalImportEnabled && provider !== "s3") {
    throw new Error("External imports require an S3-compatible destination.");
  }
  if (externalImportEnabled && encryptionMode !== "none") {
    throw new Error("External imports require destination encryption mode none.");
  }

  return { externalImportEnabled, externalImportPrefix, maxExternalImportBytes };
}

export function normalizeExternalImportBytes(value: number | string | null): string {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(numeric) ||
    numeric < MIN_EXTERNAL_IMPORT_BYTES ||
    numeric > MAX_EXTERNAL_IMPORT_BYTES
  ) {
    throw new Error(
      `External import size must be an integer between ${MIN_EXTERNAL_IMPORT_BYTES} and ${MAX_EXTERNAL_IMPORT_BYTES} bytes.`
    );
  }
  return String(numeric);
}
