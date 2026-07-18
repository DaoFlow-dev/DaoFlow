/* global process */

import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runCommand } from "./evidence-gates.mjs";
import { validateReadiness } from "./matrix.mjs";
import { formatReport, generateReport, validateReportFile } from "./report.mjs";

function claimMarker(id, state, text) {
  return `<!-- readiness-claim: id=${id} state=${state} -->\n${text}\n<!-- /readiness-claim -->`;
}

function claim({
  status = "unverified",
  text,
  evidence,
  requirements = [{ category: "audit", max_age_days: 30 }]
} = {}) {
  return {
    id: "sample-claim",
    title: "Sample claim",
    status,
    public_text: text,
    ...(status === "unverified"
      ? { required_issues: [208] }
      : { public_evidence_citation: "tests/proof.test.mjs" }),
    sources: [{ path: "README.md" }],
    evidence_requirements: requirements,
    ...(evidence ? { evidence } : {})
  };
}

async function fixture({ matrix, readme, vision = "# Vision\n" }) {
  const rootDir = await mkdtemp(resolve(tmpdir(), "daoflow-readiness-"));
  await mkdir(resolve(rootDir, "docs/docs/concepts"), { recursive: true });
  await mkdir(resolve(rootDir, "tests"), { recursive: true });
  await writeFile(resolve(rootDir, "README.md"), readme);
  await writeFile(resolve(rootDir, "docs/docs/concepts/vision.md"), vision);
  await writeFile(resolve(rootDir, "tests/proof.test.mjs"), "export {};\n");
  return { rootDir, matrix };
}

function matrixWith(claims) {
  return {
    version: 1,
    public_claim_files: ["README.md", "docs/docs/concepts/vision.md"],
    report_path: "PRODUCTION_READINESS.md",
    freshness_limits: {
      "real-infrastructure": 14,
      restore: 14,
      audit: 30,
      "agent-safety": 30,
      "source-availability": 365
    },
    claims
  };
}

test("covers every explicitly registered public claim", async () => {
  const text = "**Goal:** Keep command evidence current.";
  const setup = await fixture({
    matrix: matrixWith([claim({ text })]),
    readme: claimMarker("sample-claim", "goal", text)
  });

  expect((await validateReadiness(setup)).errors).toEqual([]);
});

test("rejects a public marker without a matrix registration", async () => {
  const text = "**Goal:** Keep command evidence current.";
  const setup = await fixture({
    matrix: matrixWith([claim({ text })]),
    readme: `${claimMarker("sample-claim", "goal", text)}\n${claimMarker("missing-claim", "goal", text)}`
  });

  expect((await validateReadiness(setup)).errors).toContain(
    "README.md:4 claim marker missing-claim is not registered"
  );
});

test("rejects self-reported evidence and unknown gates", async () => {
  const text = "**Verified in this repository:** Evidence is available at tests/proof.test.mjs.";
  const setup = await fixture({
    matrix: matrixWith([
      claim({
        status: "verified",
        text,
        evidence: [
          {
            kind: "test",
            category: "audit",
            path: "tests/proof.test.mjs",
            gate: "not-a-real-gate",
            command: "false",
            status: "passed",
            observed_on: "2026-07-18",
            max_age_days: 30
          }
        ]
      })
    ]),
    readme: claimMarker("sample-claim", "verified", text)
  });

  const errors = (await validateReadiness(setup)).errors;
  expect(errors).toContain("sample-claim evidence status must come from an executable gate");
  expect(errors).toContain("sample-claim evidence gate not-a-real-gate is not executable");
});

test("rejects evidence metadata that does not match its executable gate", async () => {
  const text = "**Verified in this repository:** Evidence is available at tests/proof.test.mjs.";
  const setup = await fixture({
    matrix: matrixWith([
      claim({
        status: "verified",
        text,
        evidence: [
          {
            kind: "test",
            category: "audit",
            path: "tests/proof.test.mjs",
            gate: "api-lanes",
            max_age_days: 30
          }
        ]
      })
    ]),
    readme: claimMarker("sample-claim", "verified", text)
  });

  expect((await validateReadiness(setup)).errors).toContain(
    "sample-claim evidence must match the registered api-lanes gate definition"
  );
});

test("rejects a verified claim without evidence", async () => {
  const text = "**Verified in this repository:** Evidence is available at tests/proof.test.mjs.";
  const setup = await fixture({
    matrix: matrixWith([claim({ status: "verified", text })]),
    readme: claimMarker("sample-claim", "verified", text)
  });

  const errors = (await validateReadiness(setup)).errors;
  expect(errors).toContain("sample-claim verified claims require evidence");
  expect(errors).toContain("sample-claim has no executable audit evidence");
});

test("rejects evidence whose freshness differs from the claim requirement", async () => {
  const text = "**Verified in this repository:** Evidence is available at tests/proof.test.mjs.";
  const setup = await fixture({
    matrix: matrixWith([
      claim({
        status: "verified",
        text,
        evidence: [
          {
            kind: "test",
            category: "audit",
            path: "tests/proof.test.mjs",
            gate: "api-lanes",
            max_age_days: 7
          }
        ]
      })
    ]),
    readme: claimMarker("sample-claim", "verified", text)
  });

  expect((await validateReadiness(setup)).errors).toContain(
    "sample-claim audit evidence freshness must match its requirement"
  );
});

test("rejects current wording for an unverified claim", async () => {
  const text = "**Verified in this repository:** The safety guarantee is complete.";
  const setup = await fixture({
    matrix: matrixWith([claim({ text })]),
    readme: claimMarker("sample-claim", "verified", text)
  });

  expect((await validateReadiness(setup)).errors).toContain(
    "sample-claim unverified claims must use a goal or current limitation marker"
  );
});

test("generates a plain-language report without evidence commands", async () => {
  const text = "**Verified in this repository:** Evidence is available at tests/proof.test.mjs.";
  const report = await formatReport(
    generateReport(
      matrixWith([
        claim({
          status: "verified",
          text,
          evidence: [
            {
              kind: "test",
              category: "audit",
              path: "tests/proof.test.mjs",
              gate: "api-lanes",
              secret: "not-for-publication",
              max_age_days: 30
            }
          ]
        })
      ])
    )
  );

  expect(report).toContain(
    "DaoFlow is not yet verified for unqualified production-readiness claims."
  );
  expect(report).toContain("Sample claim");
  expect(report).not.toContain("not-for-publication");
});

test("rejects unmarked absolute readiness claims", async () => {
  const text = "**Goal:** Keep command evidence current.";
  const setup = await fixture({
    matrix: matrixWith([claim({ text })]),
    readme: `${claimMarker("sample-claim", "goal", text)}\n\nEvery mutation is safe and immutable.`
  });

  expect((await validateReadiness(setup)).errors).toContain(
    "README.md:5 absolute readiness wording must be inside a readiness-claim marker"
  );
});

test("rejects an unqualified absolute claim hidden after a goal sentence", async () => {
  const text = "**Goal:** Keep command evidence current. Every deployment is safe.";
  const setup = await fixture({
    matrix: matrixWith([claim({ text })]),
    readme: claimMarker("sample-claim", "goal", text)
  });

  expect((await validateReadiness(setup)).errors).toContain(
    "README.md:1 goal claim sample-claim contains unqualified absolute wording"
  );
});

test("rejects absolute claims hidden after semicolons or HTML line breaks", async () => {
  for (const separator of ["; ", ";", ".", "<br>"]) {
    const text = `**Goal:** Keep command evidence current${separator}Every deployment is safe.`;
    const setup = await fixture({
      matrix: matrixWith([claim({ text })]),
      readme: claimMarker("sample-claim", "goal", text)
    });

    expect((await validateReadiness(setup)).errors).toContain(
      "README.md:1 goal claim sample-claim contains unqualified absolute wording"
    );
  }
});

test("does not treat 'not just' as qualification for an absolute claim", async () => {
  const text = "**Goal:** Keep command evidence current. Every deployment is safe, not just fast.";
  const setup = await fixture({
    matrix: matrixWith([claim({ text })]),
    readme: claimMarker("sample-claim", "goal", text)
  });

  expect((await validateReadiness(setup)).errors).toContain(
    "README.md:1 goal claim sample-claim contains unqualified absolute wording"
  );
});

test("rejects nested claim markers", async () => {
  const text = "**Goal:** Keep command evidence current.";
  const setup = await fixture({
    matrix: matrixWith([claim({ text })]),
    readme: `<!-- readiness-claim: id=sample-claim state=goal -->\n${claimMarker(
      "sample-claim",
      "goal",
      text
    )}\n<!-- /readiness-claim -->`
  });

  expect((await validateReadiness(setup)).errors).toContain(
    "README.md:2 has nested or overlapping readiness markers"
  );
});

test("treats a failing evidence command as a failed gate", async () => {
  expect(await runCommand([process.execPath, "-e", "process.exit(7)"], process.cwd())).toBe(false);
});

test("rejects a stale committed readiness report", async () => {
  const text = "**Goal:** Keep command evidence current.";
  const setup = await fixture({
    matrix: matrixWith([claim({ text })]),
    readme: claimMarker("sample-claim", "goal", text)
  });
  await writeFile(resolve(setup.rootDir, "PRODUCTION_READINESS.md"), "# Stale report\n");

  expect(await validateReportFile(setup)).toEqual([
    "PRODUCTION_READINESS.md is stale; run bun run readiness:report"
  ]);
});
