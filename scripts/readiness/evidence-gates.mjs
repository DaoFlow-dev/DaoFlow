/* global process */

import { spawn } from "node:child_process";

const GATES = {
  "api-lanes": {
    claimId: "api-lane-separation",
    kind: "test",
    category: "contract",
    path: "scripts/readiness/api-lanes.test.mjs",
    argv: ["bun", "test", "scripts/readiness/api-lanes.test.mjs"]
  },
  "cli-contract": {
    claimId: "cli-contract-surface",
    kind: "test",
    category: "contract",
    path: "docs/static/contracts/cli-contract.json",
    argv: ["bun", "run", "contracts:check"]
  },
  "license-source": {
    claimId: "open-source-license",
    kind: "test",
    category: "source-availability",
    path: "scripts/readiness/license-evidence.test.mjs",
    argv: ["bun", "test", "scripts/readiness/license-evidence.test.mjs"]
  }
};

export function isEvidenceGate(gate) {
  return Object.hasOwn(GATES, gate);
}

export function evidenceGateDefinition(gate) {
  return GATES[gate] ?? null;
}

export async function runCommand(argv, rootDir) {
  return await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "ignore", "ignore"]
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export async function runVerifiedEvidenceGates({ rootDir, matrix }) {
  const gates = new Set(
    matrix.claims
      .filter((claim) => claim.status === "verified")
      .flatMap((claim) => claim.evidence ?? [])
      .map((evidence) => evidence.gate)
      .filter(isEvidenceGate)
  );
  const errors = [];
  for (const gate of gates) {
    if (!(await runCommand(GATES[gate].argv, rootDir))) {
      errors.push(`verified evidence gate ${gate} failed for the current checkout`);
    }
  }
  return errors;
}
