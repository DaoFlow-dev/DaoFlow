import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

import {
  extractClaimMarkers,
  findUnregisteredAbsoluteClaims,
  findUnsafeAbsoluteClaimsInMarker
} from "./claim-markers.mjs";
import { evidenceGateDefinition, isEvidenceGate } from "./evidence-gates.mjs";
import { resolveRepositoryFile, resolveRepositoryOutput } from "./repository-paths.mjs";
import { validatePublicLinks } from "./public-links.mjs";

const REQUIRED_FRESHNESS_CATEGORIES = ["real-infrastructure", "restore", "audit", "agent-safety"];
export const DEFAULT_MATRIX_PATH = ".agents/references/production-readiness.yml";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function claimPrefixFor(state) {
  return {
    verified: "**Verified in this repository:**",
    goal: "**Goal:**",
    limitation: "**Current limitation:**"
  }[state];
}

export async function loadMatrix(rootDir, path = DEFAULT_MATRIX_PATH) {
  const matrixPath = await resolveRepositoryFile(rootDir, path);
  if (!matrixPath) throw new Error(`readiness matrix path is not a repository file: ${path}`);
  const source = await readFile(matrixPath, "utf8");
  const document = parseDocument(source);
  if (document.errors.length > 0)
    throw new Error(document.errors.map((error) => error.message).join("\n"));
  return document.toJS();
}

function validateFreshnessLimits(matrix, errors) {
  if (!isObject(matrix.freshness_limits)) {
    errors.push("freshness_limits must be an object");
    return;
  }

  for (const category of REQUIRED_FRESHNESS_CATEGORIES) {
    if (!isPositiveInteger(matrix.freshness_limits[category])) {
      errors.push(`freshness_limits.${category} must be a positive number of days`);
    }
  }
}

function validateRequirements(claim, matrix, errors) {
  if (!Array.isArray(claim.evidence_requirements) || claim.evidence_requirements.length === 0) {
    errors.push(`${claim.id} must declare at least one evidence requirement`);
    return new Map();
  }

  const requirements = new Map();
  for (const requirement of claim.evidence_requirements) {
    if (!isObject(requirement) || typeof requirement.category !== "string") {
      errors.push(`${claim.id} has an invalid evidence requirement`);
      continue;
    }
    if (!isPositiveInteger(requirement.max_age_days)) {
      errors.push(
        `${claim.id} ${requirement.category} freshness must be a positive number of days`
      );
    }
    if (matrix.freshness_limits?.[requirement.category] !== requirement.max_age_days) {
      errors.push(`${claim.id} ${requirement.category} freshness must match freshness_limits`);
    }
    if (requirements.has(requirement.category)) {
      errors.push(`${claim.id} repeats the ${requirement.category} evidence requirement`);
    }
    requirements.set(requirement.category, requirement);
  }

  return requirements;
}

async function validateEvidence(claim, requirements, rootDir, errors) {
  const evidence = claim.evidence ?? [];
  if (!Array.isArray(evidence)) {
    errors.push(`${claim.id} evidence must be a list`);
    return;
  }

  const coveredCategories = new Set();
  for (const item of evidence) {
    if (!isObject(item)) {
      errors.push(`${claim.id} contains invalid evidence`);
      continue;
    }
    if ("status" in item || "observed_on" in item || "command" in item) {
      errors.push(`${claim.id} evidence status must come from an executable gate`);
    }
    if (!["test", "workflow"].includes(item.kind)) {
      errors.push(`${claim.id} evidence must be a test or workflow artifact`);
    }
    if (typeof item.path !== "string" || !(await resolveRepositoryFile(rootDir, item.path))) {
      errors.push(`${claim.id} evidence path ${item.path ?? "<unknown>"} does not exist`);
    }
    if (!isEvidenceGate(item.gate)) {
      errors.push(`${claim.id} evidence gate ${item.gate ?? "<unknown>"} is not executable`);
    } else {
      const gate = evidenceGateDefinition(item.gate);
      if (
        gate.claimId !== claim.id ||
        gate.kind !== item.kind ||
        gate.category !== item.category ||
        gate.path !== item.path
      ) {
        errors.push(`${claim.id} evidence must match the registered ${item.gate} gate definition`);
      }
    }

    const requirement = requirements.get(item.category);
    if (!requirement) {
      errors.push(`${claim.id} evidence category ${item.category ?? "<unknown>"} is not required`);
      continue;
    }
    coveredCategories.add(item.category);
    if (item.max_age_days !== requirement.max_age_days) {
      errors.push(`${claim.id} ${item.category} evidence freshness must match its requirement`);
    }
  }

  if (claim.status === "verified") {
    if (evidence.length === 0) errors.push(`${claim.id} verified claims require evidence`);
    for (const category of requirements.keys()) {
      if (!coveredCategories.has(category))
        errors.push(`${claim.id} has no executable ${category} evidence`);
    }
  }
}

function validateClaimShape(claim, errors) {
  if (!isObject(claim) || typeof claim.id !== "string" || !/^[a-z0-9-]+$/.test(claim.id)) {
    errors.push("claims must have a lowercase hyphenated id");
    return false;
  }
  if (!["verified", "unverified"].includes(claim.status))
    errors.push(`${claim.id} must be verified or unverified`);
  if (typeof claim.title !== "string" || typeof claim.public_text !== "string") {
    errors.push(`${claim.id} must have a title and public_text`);
  }
  if (!Array.isArray(claim.sources) || claim.sources.length === 0) {
    errors.push(`${claim.id} must register at least one public source`);
  }
  if (
    claim.status === "unverified" &&
    (!Array.isArray(claim.required_issues) || claim.required_issues.length === 0)
  ) {
    errors.push(`${claim.id} unverified claims must name active issue dependencies`);
  }
  return true;
}

export async function validateReadiness({ rootDir, matrix }) {
  const errors = [];
  if (!isObject(matrix)) return { errors: ["readiness matrix must contain an object"] };
  if (matrix.version !== 1) errors.push("readiness matrix must declare version: 1");
  if (!Array.isArray(matrix.public_claim_files) || matrix.public_claim_files.length === 0) {
    errors.push("public_claim_files must list the claimed public documents");
  }
  if (typeof matrix.report_path !== "string" || matrix.report_path.length === 0) {
    errors.push("report_path must be set");
  } else if (!(await resolveRepositoryOutput(rootDir, matrix.report_path))) {
    errors.push("report_path must stay inside the repository and name a file");
  }
  validateFreshnessLimits(matrix, errors);

  const claims = Array.isArray(matrix.claims) ? matrix.claims : [];
  if (claims.length === 0) errors.push("claims must be a non-empty list");

  const claimsById = new Map();
  for (const claim of claims) {
    if (!validateClaimShape(claim, errors)) continue;
    if (claimsById.has(claim.id)) {
      errors.push(`duplicate claim registration: ${claim.id}`);
      continue;
    }
    claimsById.set(claim.id, claim);
  }

  const markersBySource = new Map();
  for (const sourcePath of matrix.public_claim_files ?? []) {
    try {
      const sourceFile = await resolveRepositoryFile(rootDir, sourcePath);
      if (!sourceFile) throw new Error("unsafe source path");
      const source = await readFile(sourceFile, "utf8");
      const result = extractClaimMarkers(source, sourcePath);
      errors.push(...result.errors);
      errors.push(...findUnregisteredAbsoluteClaims(source, sourcePath, result.markers));
      markersBySource.set(sourcePath, result.markers);
    } catch {
      errors.push(`public claim file ${sourcePath} must be a repository file`);
    }
  }

  const expectedMarkers = new Set();
  for (const claim of claimsById.values()) {
    const requirements = validateRequirements(claim, matrix, errors);
    if (claim.status === "verified") {
      if (
        typeof claim.public_evidence_citation !== "string" ||
        !(await resolveRepositoryFile(rootDir, claim.public_evidence_citation))
      ) {
        errors.push(`${claim.id} verified claims must cite an existing repository path`);
      }
    }
    await validateEvidence(claim, requirements, rootDir, errors);
    for (const source of claim.sources ?? []) {
      if (!isObject(source) || typeof source.path !== "string") {
        errors.push(`${claim.id} has an invalid source registration`);
        continue;
      }
      if (!markersBySource.has(source.path)) {
        errors.push(`${claim.id} source ${source.path} is not a public claim file`);
        continue;
      }
      const markerKey = `${source.path}:${claim.id}`;
      if (expectedMarkers.has(markerKey)) errors.push(`${claim.id} repeats source ${source.path}`);
      expectedMarkers.add(markerKey);
    }
  }

  for (const [sourcePath, markers] of markersBySource) {
    const seenIds = new Set();
    for (const marker of markers) {
      const markerKey = `${sourcePath}:${marker.id}`;
      if (seenIds.has(marker.id))
        errors.push(`${sourcePath}:${marker.line} repeats claim marker ${marker.id}`);
      seenIds.add(marker.id);

      const claim = claimsById.get(marker.id);
      if (!claim) {
        errors.push(`${sourcePath}:${marker.line} claim marker ${marker.id} is not registered`);
        continue;
      }
      if (!expectedMarkers.has(markerKey)) {
        errors.push(
          `${sourcePath}:${marker.line} claim marker ${marker.id} is not registered for this source`
        );
      }
      if (claim.status === "unverified" && !["goal", "limitation"].includes(marker.state)) {
        errors.push(`${marker.id} unverified claims must use a goal or current limitation marker`);
      }
      if (claim.status === "verified" && marker.state !== "verified") {
        errors.push(`${marker.id} verified claims must use a verified marker`);
      }
      if (!marker.body.startsWith(claimPrefixFor(marker.state))) {
        errors.push(`${marker.id} does not use the safe wording required by its marker`);
      }
      if (marker.body !== claim.public_text) {
        errors.push(`${marker.id} public wording differs from production-readiness.yml`);
      }
      errors.push(...findUnsafeAbsoluteClaimsInMarker(marker, sourcePath));
      if (
        claim.status === "verified" &&
        !marker.body.includes(claim.public_evidence_citation ?? "")
      ) {
        errors.push(`${marker.id} verified public wording must cite repository evidence`);
      }
      await validatePublicLinks({ rootDir, sourcePath, marker, errors });
    }
  }

  for (const markerKey of expectedMarkers) {
    const separator = markerKey.indexOf(":");
    const sourcePath = markerKey.slice(0, separator);
    const id = markerKey.slice(separator + 1);
    if (!markersBySource.get(sourcePath)?.some((marker) => marker.id === id)) {
      errors.push(`${id} is registered for ${sourcePath} but has no public marker`);
    }
  }

  return { errors };
}
