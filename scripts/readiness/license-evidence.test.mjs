import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("publishes the Apache 2.0 license named by the public claim", async () => {
  const license = await readFile(resolve(import.meta.dir, "../../LICENSE"), "utf8");
  expect(license).toContain("Apache License");
  expect(license).toContain("Version 2.0");
});
