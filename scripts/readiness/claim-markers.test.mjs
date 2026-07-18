import { expect, test } from "bun:test";

import { extractClaimMarkers, findUnregisteredAbsoluteClaims } from "./claim-markers.mjs";

function marker(id, syntax = "markdown") {
  return syntax === "mdx"
    ? `{/* readiness-claim: id=${id} state=goal */}\n**Goal:** Keep evidence current.\n{/* /readiness-claim */}`
    : `<!-- readiness-claim: id=${id} state=goal -->\n**Goal:** Keep evidence current.\n<!-- /readiness-claim -->`;
}

test("accepts adjacent Markdown and MDX claim ranges", () => {
  const result = extractClaimMarkers(`${marker("markdown")}\n${marker("mdx", "mdx")}`, "claims.md");

  expect(result.errors).toEqual([]);
  expect(result.markers.map(({ id }) => id)).toEqual(["markdown", "mdx"]);
});

test("rejects a closing marker that does not match its opener", () => {
  const content = `{/* readiness-claim: id=sample state=goal */}\n**Goal:** Keep evidence current.\n<!-- /readiness-claim -->\n{/* /readiness-claim */}`;

  expect(extractClaimMarkers(content, "vision.md").errors).toContain(
    "vision.md:3 has a closing readiness-claim marker that does not match {/*"
  );
});

test("rejects same-syntax and mixed-syntax nested claim ranges", () => {
  for (const inner of [marker("inner"), marker("inner", "mdx")]) {
    const content = `<!-- readiness-claim: id=outer state=goal -->\n${inner}\n<!-- /readiness-claim -->`;
    expect(extractClaimMarkers(content, "claims.md").errors.length).toBeGreaterThan(0);
  }
});

test("detects visible absolute wording after an MDX comment", () => {
  expect(
    findUnregisteredAbsoluteClaims("{/* note */} Every deployment is safe.", "vision.md", [])
  ).toContain("vision.md:1 absolute readiness wording must be inside a readiness-claim marker");
});

test("ignores absolute wording contained entirely inside comments", () => {
  expect(
    findUnregisteredAbsoluteClaims(
      "{/* Every deployment is safe. */}\n<!-- Every deployment is safe. -->",
      "vision.md",
      []
    )
  ).toEqual([]);
});
