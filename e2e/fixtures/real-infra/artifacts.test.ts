import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealInfraArtifacts } from "./artifacts";

describe("real infrastructure artifacts", () => {
  test("reset removes previous-run evidence before a new invocation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "daoflow-real-infra-artifacts-"));
    const artifacts = new RealInfraArtifacts(directory);
    try {
      await artifacts.outcome("old-attempt", "failed", { reason: "old failure" });
      await artifacts.result("failed", { reason: "old failure" });
      await artifacts.cleanup("failed", { reason: "old failure" });

      await artifacts.reset();

      expect(await readFile(join(directory, "command-outcomes.jsonl"), "utf8")).toBe("");
      await expect(readFile(join(directory, "result.json"), "utf8")).rejects.toThrow();
      await expect(readFile(join(directory, "cleanup.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
