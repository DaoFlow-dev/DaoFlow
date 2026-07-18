/* global console, process */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { runVerifiedEvidenceGates } from "./evidence-gates.mjs";
import { loadMatrix, validateReadiness } from "./matrix.mjs";
import { formatReport, generateReport } from "./report.mjs";
import { resolveRepositoryOutput } from "./repository-paths.mjs";

const rootDir = process.cwd();
const outputIndex = process.argv.indexOf("--output");
const requestedOutput = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
const matrix = await loadMatrix(rootDir);
const { errors } = await validateReadiness({ rootDir, matrix });
if (errors.length === 0) errors.push(...(await runVerifiedEvidenceGates({ rootDir, matrix })));

const output = requestedOutput ?? matrix.report_path;
const outputPath = await resolveRepositoryOutput(rootDir, output);
if (!outputPath) errors.push(`report output must stay inside the repository: ${output}`);

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, await formatReport(generateReport(matrix)), "utf8");
console.log(`Wrote ${outputPath}`);
