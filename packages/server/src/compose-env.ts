export const COMPOSE_ENV_FILE_NAME = ".daoflow.compose.env";
export const COMPOSE_ENV_EXPORT_FILE_NAME = ".daoflow.compose.export.sh";

export const COMPOSE_ENV_PRECEDENCE = [
  "repo-defaults",
  "environment-variables"
] as const satisfies readonly string[];

export type ComposeEnvVariableCategory = "runtime" | "build";
export type ComposeEnvEntryOrigin = "repo-default" | "environment-variable";
export type ComposeEnvEntrySource = "inline" | "1password" | "repo-default";

export interface ComposeEnvPayloadEntry {
  key: string;
  value: string;
  category: ComposeEnvVariableCategory;
  isSecret: boolean;
  source: "inline" | "1password";
  branchPattern: string | null;
}

export interface ComposeEnvMaterializedEntry {
  key: string;
  value: string;
  category: ComposeEnvVariableCategory | "default";
  isSecret: boolean;
  source: ComposeEnvEntrySource;
  branchPattern: string | null;
  origin: ComposeEnvEntryOrigin;
  overrodeRepoDefault: boolean;
}

export interface ComposeEnvEvidenceEntry {
  key: string;
  displayValue: string;
  category: ComposeEnvVariableCategory | "default";
  isSecret: boolean;
  source: ComposeEnvEntrySource;
  branchPattern: string | null;
  origin: ComposeEnvEntryOrigin;
  overrodeRepoDefault: boolean;
}

export interface ComposeEnvEvidence {
  status: "queued" | "materialized";
  branch: string;
  fileName: string;
  precedence: string[];
  counts: {
    total: number;
    repoDefaults: number;
    environmentVariables: number;
    runtime: number;
    build: number;
    secrets: number;
    overriddenRepoDefaults: number;
  };
  warnings: string[];
  entries: ComposeEnvEvidenceEntry[];
}

export interface ComposeEnvRenderableEntry {
  key: string;
  value: string;
  origin?: ComposeEnvEntryOrigin;
}

interface ParsedComposeEnvFile {
  entries: Array<{ key: string; value: string }>;
  warnings: string[];
}

const SAFE_ENV_VALUE_PATTERN = /^[a-zA-Z0-9_./:@%+=,-]+$/;
const VALID_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function unescapeDoubleQuotedEnvValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function formatEnvValue(value: string): string {
  return SAFE_ENV_VALUE_PATTERN.test(value) ? value : JSON.stringify(value);
}

function escapeComposeInterpolation(value: string): string {
  return value.replace(/\$/g, "$$$$");
}

function shellEscapeEnvValue(value: string): string {
  return "'" + value.replace(/'/g, `'"'"'`) + "'";
}

function assertValidEnvKey(key: string): string {
  if (!VALID_ENV_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid environment variable key "${key}".`);
  }

  return key;
}

export function renderComposeEnvFile(entries: ComposeEnvRenderableEntry[]): string {
  return (
    entries
      .map((entry) => {
        const key = assertValidEnvKey(entry.key);
        const value =
          entry.origin === "environment-variable"
            ? escapeComposeInterpolation(entry.value)
            : entry.value;
        return `${key}=${formatEnvValue(value)}`;
      })
      .join("\n") + "\n"
  );
}

export function renderComposeEnvExportFile(entries: ComposeEnvRenderableEntry[]): string {
  return (
    entries
      .map((entry) => `export ${assertValidEnvKey(entry.key)}=${shellEscapeEnvValue(entry.value)}`)
      .join("\n") + "\n"
  );
}

function toEvidenceEntry(entry: ComposeEnvMaterializedEntry): ComposeEnvEvidenceEntry {
  return {
    key: entry.key,
    displayValue:
      entry.origin === "repo-default"
        ? "[repo-default]"
        : entry.isSecret
          ? "[secret]"
          : entry.value,
    category: entry.category,
    isSecret: entry.isSecret,
    source: entry.source,
    branchPattern: entry.branchPattern,
    origin: entry.origin,
    overrodeRepoDefault: entry.overrodeRepoDefault
  };
}

function buildWarnings(entries: ComposeEnvPayloadEntry[], includeRepoDefaults: boolean): string[] {
  const warnings: string[] = [];

  if (includeRepoDefaults) {
    warnings.push(
      "Checked-in repo defaults are masked in deployment evidence to avoid leaking repository secrets."
    );
  }

  if (entries.some((entry) => entry.category === "build")) {
    warnings.push(
      "Build-category variables currently flow through Compose interpolation; BuildKit-specific secret handling remains a separate capability."
    );
  }

  return warnings;
}

function buildEvidence(
  status: "queued" | "materialized",
  branch: string,
  entries: ComposeEnvMaterializedEntry[],
  warnings: string[]
): ComposeEnvEvidence {
  const sortedEntries = [...entries].sort((a, b) => a.key.localeCompare(b.key));

  return {
    status,
    branch,
    fileName: COMPOSE_ENV_FILE_NAME,
    precedence: [...COMPOSE_ENV_PRECEDENCE],
    counts: {
      total: sortedEntries.length,
      repoDefaults: sortedEntries.filter((entry) => entry.origin === "repo-default").length,
      environmentVariables: sortedEntries.filter((entry) => entry.origin === "environment-variable")
        .length,
      runtime: sortedEntries.filter((entry) => entry.category === "runtime").length,
      build: sortedEntries.filter((entry) => entry.category === "build").length,
      secrets: sortedEntries.filter((entry) => entry.isSecret).length,
      overriddenRepoDefaults: sortedEntries.filter((entry) => entry.overrodeRepoDefault).length
    },
    warnings,
    entries: sortedEntries.map(toEvidenceEntry)
  };
}

export function matchesComposeEnvBranchPattern(
  branchPattern: string | null | undefined,
  branch: string
): boolean {
  if (!branchPattern) {
    return true;
  }

  const pattern = `^${branchPattern.split("*").map(escapeRegex).join(".*")}$`;
  return new RegExp(pattern).test(branch);
}

export function parseComposeEnvFile(content: string): ParsedComposeEnvFile {
  const entries = new Map<string, string>();
  const warnings: string[] = [];

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      warnings.push(`Ignored invalid .env line ${index + 1}.`);
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!VALID_ENV_KEY_PATTERN.test(key)) {
      warnings.push(`Ignored invalid .env key "${key}" on line ${index + 1}.`);
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = unescapeDoubleQuotedEnvValue(value);
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trimEnd();
    }

    entries.set(key, value);
  }

  return {
    entries: [...entries.entries()].map(([key, value]) => ({ key, value })),
    warnings
  };
}

export function buildQueuedComposeEnvEvidence(
  branch: string,
  entries: ComposeEnvPayloadEntry[]
): ComposeEnvEvidence {
  const materializedEntries = entries.map(
    (entry) =>
      ({
        ...entry,
        origin: "environment-variable",
        overrodeRepoDefault: false
      }) satisfies ComposeEnvMaterializedEntry
  );

  return buildEvidence("queued", branch, materializedEntries, buildWarnings(entries, false));
}

export function buildMaterializedComposeEnvEvidence(
  branch: string,
  entries: ComposeEnvMaterializedEntry[],
  warnings: string[] = []
): ComposeEnvEvidence {
  return buildEvidence("materialized", branch, entries, warnings);
}

export function buildComposeEnvArtifact(input: {
  branch: string;
  repoDefaultContent?: string | null;
  deploymentEntries: ComposeEnvPayloadEntry[];
}): {
  envFileContents: string;
  payloadEntries: ComposeEnvMaterializedEntry[];
  composeEnv: ComposeEnvEvidence;
} {
  const parsedRepoDefaults = input.repoDefaultContent
    ? parseComposeEnvFile(input.repoDefaultContent)
    : { entries: [], warnings: [] };

  const resolvedEntries = new Map<string, ComposeEnvMaterializedEntry>();

  for (const repoDefault of parsedRepoDefaults.entries) {
    resolvedEntries.set(repoDefault.key, {
      key: repoDefault.key,
      value: repoDefault.value,
      category: "default",
      isSecret: false,
      source: "repo-default",
      branchPattern: null,
      origin: "repo-default",
      overrodeRepoDefault: false
    });
  }

  for (const entry of input.deploymentEntries) {
    const previous = resolvedEntries.get(entry.key);
    resolvedEntries.set(entry.key, {
      ...entry,
      origin: "environment-variable",
      overrodeRepoDefault: previous?.origin === "repo-default"
    });
  }

  const payloadEntries = [...resolvedEntries.values()].sort((a, b) => a.key.localeCompare(b.key));
  const envFileContents = renderComposeEnvFile(payloadEntries);

  return {
    envFileContents,
    payloadEntries,
    composeEnv: buildEvidence("materialized", input.branch, payloadEntries, [
      ...parsedRepoDefaults.warnings,
      ...buildWarnings(input.deploymentEntries, parsedRepoDefaults.entries.length > 0)
    ])
  };
}
