import { readFile } from "node:fs/promises";
import { format } from "prettier";

import { resolveRepositoryFile } from "./repository-paths.mjs";

function issueLinks(issues) {
  return issues
    .map((issue) => `[#${issue}](https://github.com/DaoFlow-dev/DaoFlow/issues/${issue})`)
    .join(", ");
}

function evidenceRequirements(claim) {
  return claim.evidence_requirements
    .map(
      (requirement) =>
        `${requirement.category.replaceAll("-", " ")} (${requirement.max_age_days} days)`
    )
    .join("; ");
}

function evidenceGates(claim) {
  return (claim.evidence ?? [])
    .map(
      (evidence) =>
        `\`${evidence.gate}\` checks \`${evidence.path}\` for the current checkout (freshness limit: ${evidence.max_age_days} days)`
    )
    .join("; ");
}

function claimSection(claim) {
  const lines = [`### ${claim.title}`, "", claim.public_text, ""];
  lines.push(`- Required fresh evidence: ${evidenceRequirements(claim)}`);
  lines.push(
    claim.status === "verified"
      ? `- Repository citation: \`${claim.public_evidence_citation}\``
      : `- Unverified dependencies: ${issueLinks(claim.required_issues)}`
  );
  if (claim.status === "verified") lines.push(`- Executed evidence: ${evidenceGates(claim)}`);
  return lines.join("\n");
}

export function generateReport(matrix) {
  const verified = matrix.claims.filter((claim) => claim.status === "verified");
  const unverified = matrix.claims.filter((claim) => claim.status === "unverified");
  const freshness = Object.entries(matrix.freshness_limits)
    .map(([category, days]) => `| ${category.replaceAll("-", " ")} | ${days} days |`)
    .join("\n");

  return [
    "# DaoFlow Production Readiness",
    "",
    "> Generated from `.agents/references/production-readiness.yml`. Check it with `bun run readiness:check`.",
    "",
    "## Current status",
    "",
    "DaoFlow is not yet verified for unqualified production-readiness claims. The unverified items below remain goals or current limitations until their required evidence is current and passing.",
    "",
    "## Evidence freshness limits",
    "",
    "| Evidence area | Maximum age |",
    "| --- | --- |",
    freshness,
    "",
    "## Verified repository facts",
    "",
    ...(verified.length === 0
      ? ["No readiness claims are currently verified."]
      : verified.map(claimSection)),
    "",
    "## Goals and current limitations",
    "",
    ...unverified.map(claimSection),
    "",
    "## How to update this report",
    "",
    "Add passing, fresh test or workflow evidence to the matrix, update the matching marked public statement, run `bun run readiness:report`, and then run `bun run readiness:check`. The release workflow attaches this report as a public release asset; it intentionally contains claim status and repository evidence references only, never workflow logs or credentials.",
    ""
  ].join("\n");
}

export function formatReport(report) {
  return format(report, { parser: "markdown" });
}

export async function validateReportFile({ rootDir, matrix }) {
  const generatedReport = await formatReport(generateReport(matrix));
  try {
    const reportPath = await resolveRepositoryFile(rootDir, matrix.report_path);
    if (!reportPath) throw new Error("unsafe report path");
    const committedReport = await readFile(reportPath, "utf8");
    return committedReport === generatedReport
      ? []
      : [`${matrix.report_path} is stale; run bun run readiness:report`];
  } catch {
    return [`${matrix.report_path} is missing; run bun run readiness:report`];
  }
}
