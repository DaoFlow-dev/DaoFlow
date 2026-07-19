import { appendFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { redactArtifactValue } from "./redaction";

type Outcome = "passed" | "failed" | "skipped";

export class RealInfraArtifacts {
  constructor(
    readonly directory: string,
    private readonly sensitiveValues: readonly string[] = []
  ) {}

  async prepare() {
    await mkdir(this.directory, { recursive: true });
    await this.ensureFile("command-outcomes.jsonl", "");
  }

  async reset() {
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, "command-outcomes.jsonl"), "", "utf8");
    await rm(join(this.directory, "result.json"), { force: true });
    await rm(join(this.directory, "cleanup.json"), { force: true });
  }

  async outcome(name: string, outcome: Outcome, details: Record<string, unknown> = {}) {
    await this.prepare();
    const record = redactArtifactValue(
      { at: new Date().toISOString(), name, outcome, details },
      this.sensitiveValues
    );
    await appendFile(join(this.directory, "command-outcomes.jsonl"), `${JSON.stringify(record)}\n`);
  }

  async result(status: Outcome, details: Record<string, unknown>) {
    await this.prepare();
    await this.writeJson("result.json", { status, ...details });
  }

  async cleanup(status: Outcome, details: Record<string, unknown>) {
    await this.prepare();
    await this.writeJson("cleanup.json", { status, ...details });
  }

  private async writeJson(name: string, value: Record<string, unknown>) {
    const redacted = redactArtifactValue(value, this.sensitiveValues);
    await writeFile(join(this.directory, name), `${JSON.stringify(redacted, null, 2)}\n`, "utf8");
  }

  private async ensureFile(name: string, contents: string) {
    try {
      await stat(join(this.directory, name));
    } catch {
      await writeFile(join(this.directory, name), contents, "utf8");
    }
  }
}

export async function ensureArtifactFiles(directory: string) {
  const artifacts = new RealInfraArtifacts(directory);
  await artifacts.prepare();
  try {
    await stat(join(directory, "result.json"));
  } catch {
    await artifacts.result("failed", { reason: "Harness ended before writing a result." });
  }
  try {
    await stat(join(directory, "cleanup.json"));
  } catch {
    await artifacts.cleanup("skipped", { reason: "No remote cleanup was started." });
  }
}
