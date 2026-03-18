import {
  buildComposeEnvArtifact,
  type ComposeEnvEvidence,
  type ComposeEnvPayloadEntry
} from "./compose-env";

export interface ComposeInterpolationReference {
  key: string;
  expression: string;
  source: "plain" | "braced";
  required: boolean;
  hasDefault: boolean;
}

export interface ComposeInterpolationIssue {
  key: string;
  expression: string;
  severity: "warn" | "fail";
  detail: string;
}

export interface ComposeEnvPlanDiagnostics {
  branch: string;
  matchedBranchOverrideCount: number;
  composeEnv: ComposeEnvEvidence;
  interpolation: {
    status: "ok" | "warn" | "fail" | "unavailable";
    summary: {
      totalReferences: number;
      unresolved: number;
      requiredMissing: number;
      optionalMissing: number;
    };
    warnings: string[];
    references: ComposeInterpolationReference[];
    unresolved: ComposeInterpolationIssue[];
  };
}

const ESCAPED_DOLLAR_SENTINEL = "\u0000";
const VALID_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRACED_OPERATORS = [":-", ":?", ":+", "-", "?", "+"] as const;

interface ParsedInterpolation {
  key: string;
  expression: string;
  source: "plain" | "braced";
  required: boolean;
  hasDefault: boolean;
}

function stripYamlComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (!character) {
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\" && inDoubleQuote) {
      escaped = true;
      continue;
    }

    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (character === "#" && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index);
    }
  }

  return line;
}

function parseBracedInterpolation(body: string): ParsedInterpolation | null {
  let key = body;
  let operator: string | null = null;

  for (const candidate of BRACED_OPERATORS) {
    const index = body.indexOf(candidate);
    if (index > 0) {
      key = body.slice(0, index);
      operator = candidate;
      break;
    }
  }

  if (!VALID_ENV_KEY_PATTERN.test(key)) {
    return null;
  }

  return {
    key,
    expression: `\${${body}}`,
    source: "braced",
    required: operator === "?" || operator === ":?",
    hasDefault: operator === "-" || operator === ":-"
  };
}

function parseComposeInterpolationReferences(content: string): ComposeInterpolationReference[] {
  const references = new Map<string, ComposeInterpolationReference>();

  for (const rawLine of content.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) {
      continue;
    }

    const withoutComments = stripYamlComment(rawLine).replace(/\$\$/g, ESCAPED_DOLLAR_SENTINEL);
    if (!withoutComments.includes("$")) {
      continue;
    }

    let plainScanSource = withoutComments;
    const bracedMatches = withoutComments.matchAll(/\$\{([^}]+)\}/g);
    for (const match of bracedMatches) {
      const body = match[1];
      if (!body) {
        continue;
      }

      const parsed = parseBracedInterpolation(body);
      if (!parsed) {
        continue;
      }

      references.set(`${parsed.key}:${parsed.expression}`, parsed);
      plainScanSource = plainScanSource.replace(match[0], " ".repeat(match[0].length));
    }

    const plainMatches = plainScanSource.matchAll(/(^|[^$])\$([A-Za-z_][A-Za-z0-9_]*)/g);
    for (const match of plainMatches) {
      const key = match[2];
      if (!key) {
        continue;
      }

      const expression = `$${key}`;
      references.set(`${key}:${expression}`, {
        key,
        expression,
        source: "plain",
        required: false,
        hasDefault: false
      });
    }
  }

  return [...references.values()].sort((a, b) => {
    const keyCompare = a.key.localeCompare(b.key);
    return keyCompare !== 0 ? keyCompare : a.expression.localeCompare(b.expression);
  });
}

export function buildComposeEnvPlanDiagnostics(input: {
  branch: string;
  composeContent?: string | null;
  repoDefaultContent?: string | null;
  deploymentEntries: ComposeEnvPayloadEntry[];
  warnings?: string[];
}): ComposeEnvPlanDiagnostics {
  const artifact = buildComposeEnvArtifact({
    branch: input.branch,
    repoDefaultContent: input.repoDefaultContent,
    deploymentEntries: input.deploymentEntries
  });
  const resolvedKeys = new Set(artifact.payloadEntries.map((entry) => entry.key));
  const references = input.composeContent
    ? parseComposeInterpolationReferences(input.composeContent)
    : [];
  const unresolved = references.flatMap((reference) => {
    if (resolvedKeys.has(reference.key) || reference.hasDefault) {
      return [];
    }

    return [
      {
        key: reference.key,
        expression: reference.expression,
        severity: reference.required ? "fail" : "warn",
        detail: reference.required
          ? `Required Compose interpolation ${reference.expression} is unresolved for branch ${input.branch}.`
          : `Compose interpolation ${reference.expression} is unresolved for branch ${input.branch}; Docker Compose will substitute a blank string.`
      } satisfies ComposeInterpolationIssue
    ];
  });

  const requiredMissing = unresolved.filter((issue) => issue.severity === "fail").length;
  const optionalMissing = unresolved.filter((issue) => issue.severity === "warn").length;
  const warnings = [...(input.warnings ?? [])];

  const interpolationStatus = !input.composeContent
    ? "unavailable"
    : requiredMissing > 0
      ? "fail"
      : optionalMissing > 0 || warnings.length > 0
        ? "warn"
        : "ok";

  return {
    branch: input.branch,
    matchedBranchOverrideCount: input.deploymentEntries.filter((entry) => entry.branchPattern)
      .length,
    composeEnv: artifact.composeEnv,
    interpolation: {
      status: interpolationStatus,
      summary: {
        totalReferences: references.length,
        unresolved: unresolved.length,
        requiredMissing,
        optionalMissing
      },
      warnings,
      references,
      unresolved
    }
  };
}
