import { expect, test } from "bun:test";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { validateReadiness } from "./matrix.mjs";
import {
  isSafeRepositoryLink,
  resolveRepositoryFile,
  resolveRepositoryOutput
} from "./repository-paths.mjs";

function claimMarker(id, state, text) {
  return `<!-- readiness-claim: id=${id} state=${state} -->\n${text}\n<!-- /readiness-claim -->`;
}

function matrixWith(claims) {
  return {
    version: 1,
    public_claim_files: ["README.md"],
    report_path: "PRODUCTION_READINESS.md",
    freshness_limits: {
      "real-infrastructure": 14,
      restore: 14,
      audit: 30,
      "agent-safety": 30
    },
    claims
  };
}

function sampleClaim(text) {
  return {
    id: "sample-claim",
    title: "Sample claim",
    status: "unverified",
    public_text: text,
    required_issues: [208],
    sources: [{ path: "README.md" }],
    evidence_requirements: [{ category: "audit", max_age_days: 30 }]
  };
}

async function fixture(readme) {
  const rootDir = await mkdtemp(resolve(tmpdir(), "daoflow-readiness-paths-"));
  await writeFile(resolve(rootDir, "README.md"), readme);
  return rootDir;
}

test("rejects paths and links that escape the repository", async () => {
  const text = "**Goal:** Keep command evidence [outside](../../outside.md).";
  const rootDir = await fixture(claimMarker("sample-claim", "goal", text));
  const matrix = { ...matrixWith([sampleClaim(text)]), report_path: "../outside.md" };

  const errors = (await validateReadiness({ rootDir, matrix })).errors;
  expect(errors).toContain("report_path must stay inside the repository and name a file");
  expect(errors).toContain("sample-claim contains a link outside the repository: ../../outside.md");
});

test("rejects absolute public sources and directory citations", async () => {
  const text = "**Current limitation:** Evidence is not yet verified.";
  const rootDir = await fixture(claimMarker("sample-claim", "limitation", text));
  await mkdir(resolve(rootDir, "evidence"));
  const matrix = {
    ...matrixWith([
      {
        ...sampleClaim(text),
        sources: [{ path: "/tmp/outside.md" }]
      }
    ]),
    public_claim_files: ["/tmp/outside.md"]
  };

  const errors = (await validateReadiness({ rootDir, matrix })).errors;
  expect(errors).toContain("public claim file /tmp/outside.md must be a repository file");
  expect(errors).toContain("sample-claim source /tmp/outside.md is not a public claim file");
  expect(await resolveRepositoryFile(rootDir, "evidence")).toBeNull();
});

test("rejects absolute and dangling-symlink report outputs", async () => {
  const rootDir = await fixture("# Readiness\n");
  const outsidePath = resolve(tmpdir(), `daoflow-readiness-outside-${Date.now()}.md`);
  await symlink(outsidePath, resolve(rootDir, "PRODUCTION_READINESS.md"));

  expect(await resolveRepositoryOutput(rootDir, "/tmp/outside.md")).toBeNull();
  expect(await resolveRepositoryOutput(rootDir, "PRODUCTION_READINESS.md")).toBeNull();
});

test("rejects evidence files reached through an escaping symlink", async () => {
  const rootDir = await fixture("# Readiness\n");
  const outsideDir = await mkdtemp(resolve(tmpdir(), "daoflow-readiness-outside-"));
  await writeFile(resolve(outsideDir, "proof.md"), "outside\n");
  await symlink(outsideDir, resolve(rootDir, "evidence"));

  expect(await resolveRepositoryFile(rootDir, "evidence/proof.md")).toBeNull();
});

test("rejects outputs whose missing parent is a dangling symlink", async () => {
  const rootDir = await fixture("# Readiness\n");
  const outsideDir = resolve(tmpdir(), `daoflow-readiness-missing-${Date.now()}`);
  await symlink(outsideDir, resolve(rootDir, "dist"));

  expect(await resolveRepositoryOutput(rootDir, "dist/PRODUCTION_READINESS.md")).toBeNull();
});

test("normalizes hosted repository links before allowing them", async () => {
  const rootDir = await fixture("# Readiness\n");

  expect(
    await isSafeRepositoryLink(
      rootDir,
      "README.md",
      "https://github.com/DaoFlow-dev/DaoFlow/blob/main/LICENSE"
    )
  ).toBe(true);
  expect(
    await isSafeRepositoryLink(
      rootDir,
      "README.md",
      "https://github.com/DaoFlow-dev/DaoFlow/../../other/repository"
    )
  ).toBe(false);
  expect(
    await isSafeRepositoryLink(
      rootDir,
      "README.md",
      "https://github.com/DaoFlow-dev/DaoFlow/%2F..%2F..%2Fother/repository"
    )
  ).toBe(false);
  expect(
    await isSafeRepositoryLink(
      rootDir,
      "README.md",
      "https://github.com/DaoFlow-dev/DaoFlow/%252F..%252F..%252Fother/repository"
    )
  ).toBe(false);
});

test("rejects reference-style links instead of leaving them unchecked", async () => {
  const text = "**Goal:** Keep command evidence [inside][evidence].";
  const rootDir = await fixture(claimMarker("sample-claim", "goal", text));
  const matrix = matrixWith([sampleClaim(text)]);

  expect((await validateReadiness({ rootDir, matrix })).errors).toContain(
    "sample-claim uses unsupported link syntax; use an inline Markdown link"
  );
});

test("rejects shortcut reference links whose definition could be outside the marker", async () => {
  const text = "**Goal:** Keep command evidence [evidence].";
  const rootDir = await fixture(
    `${claimMarker("sample-claim", "goal", text)}\n\n[evidence]: https://example.com/outside`
  );
  const matrix = matrixWith([sampleClaim(text)]);

  expect((await validateReadiness({ rootDir, matrix })).errors).toContain(
    "sample-claim uses unsupported link syntax; use an inline Markdown link"
  );
});

test("decodes local link traversal before checking containment", async () => {
  const rootDir = await fixture("# Readiness\n");
  await mkdir(resolve(rootDir, "%2e%2e"));
  await writeFile(resolve(rootDir, "%2e%2e/proof.md"), "misleading local file\n");

  expect(await isSafeRepositoryLink(rootDir, "README.md", "%252e%252e/proof.md")).toBe(false);
});
