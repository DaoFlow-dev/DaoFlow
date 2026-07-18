/* global console, process */

import { runVerifiedEvidenceGates } from "./evidence-gates.mjs";
import { loadMatrix, validateReadiness } from "./matrix.mjs";
import { validateReportFile } from "./report.mjs";

const rootDir = process.cwd();
const matrix = await loadMatrix(rootDir);
const { errors } = await validateReadiness({ rootDir, matrix });
if (errors.length === 0) {
  errors.push(...(await runVerifiedEvidenceGates({ rootDir, matrix })));
  errors.push(...(await validateReportFile({ rootDir, matrix })));
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Production readiness evidence and report are current.");
