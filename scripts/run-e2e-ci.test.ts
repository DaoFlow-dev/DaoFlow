import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const wrapperPath = resolve(import.meta.dir, "run-e2e-ci.sh");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type WrapperResult = {
  exitCode: number | null;
  invocations: string[][];
  log: string;
};

function runWrapper(input: { outcomes: string[]; script?: string; specs?: string }): WrapperResult {
  const directory = mkdtempSync(join(tmpdir(), "daoflow-run-e2e-ci-"));
  temporaryDirectories.push(directory);

  const fakeBunPath = join(directory, "fake-bun.sh");
  const attemptsPath = join(directory, "attempts");
  const invocationsPath = join(directory, "invocations");
  const logPath = join(directory, "e2e-ci.log");
  const outcomesPath = join(directory, "outcomes");

  writeFileSync(outcomesPath, `${input.outcomes.join("\n")}\n`);
  writeFileSync(
    fakeBunPath,
    `#!/usr/bin/env bash
set -eu

attempt="$(cat "$E2E_ATTEMPTS_FILE" 2>/dev/null || printf '0')"
attempt=$((attempt + 1))
printf '%s\\n' "$attempt" > "$E2E_ATTEMPTS_FILE"

for argument in "$@"; do
  printf '%s\\037' "$argument" >> "$E2E_INVOCATIONS_FILE"
done
printf '\\036' >> "$E2E_INVOCATIONS_FILE"

outcome="$(sed -n "\${attempt}p" "$E2E_OUTCOMES_FILE")"
case "$outcome" in
  success)
    printf 'lane attempt %s passed\\n' "$attempt"
    exit 0
    ;;
  ordinary-failure)
    printf 'ordinary assertion failure on attempt %s\\n' "$attempt"
    exit 23
    ;;
  sigabrt)
    printf 'Bun terminated by SIGABRT on attempt %s\\n' "$attempt"
    exit 134
    ;;
  sigill)
    printf 'Bun terminated by SIGILL on attempt %s\\n' "$attempt"
    exit 132
    ;;
  sigsegv)
    printf 'Bun terminated by SIGSEGV on attempt %s\\n' "$attempt"
    exit 139
    ;;
  panic)
    printf 'panic(main thread): Segmentation fault on attempt %s\\n' "$attempt"
    exit 139
    ;;
  bun-crash)
    printf 'oh no: Bun has crashed on attempt %s\\n' "$attempt"
    exit 139
    ;;
  *)
    printf 'unknown fake Bun outcome: %s\\n' "$outcome" >&2
    exit 99
    ;;
esac
`
  );
  chmodSync(fakeBunPath, 0o755);

  const environment = {
    ...process.env,
    BUN_BIN: fakeBunPath,
    E2E_ATTEMPTS_FILE: attemptsPath,
    E2E_INVOCATIONS_FILE: invocationsPath,
    E2E_LOG_FILE: logPath,
    E2E_OUTCOMES_FILE: outcomesPath,
    E2E_SCRIPT: input.script ?? "test:e2e:main"
  };

  if (input.specs === undefined) {
    delete environment.E2E_SPECS;
  } else {
    environment.E2E_SPECS = input.specs;
  }

  const result = spawnSync("bash", [wrapperPath], {
    encoding: "utf8",
    env: environment
  });
  if (result.error) {
    throw result.error;
  }

  return {
    exitCode: result.status,
    invocations: readInvocations(invocationsPath),
    log: readFileSync(logPath, "utf8")
  };
}

function readInvocations(path: string): string[][] {
  return readFileSync(path, "utf8")
    .split("\x1e")
    .filter(Boolean)
    .map((invocation) => invocation.split("\x1f").filter(Boolean));
}

test("returns immediately after a successful E2E lane", () => {
  const result = runWrapper({ outcomes: ["success"], script: "test:e2e:worker" });

  expect(result.exitCode).toBe(0);
  expect(result.invocations).toEqual([["run", "test:e2e:worker"]]);
  expect(result.log).toContain("lane attempt 1 passed");
  expect(result.log).not.toContain("retrying this E2E lane once");
});

test("preserves an ordinary E2E lane failure without retrying", () => {
  const result = runWrapper({ outcomes: ["ordinary-failure"] });

  expect(result.exitCode).toBe(23);
  expect(result.invocations).toHaveLength(1);
  expect(result.log).toContain("ordinary assertion failure on attempt 1");
  expect(result.log).not.toContain("retrying this E2E lane once");
});

test("retries once after every confirmed Bun native crash marker and forwards specs", () => {
  const crashOutcomes = ["sigabrt", "sigill", "sigsegv", "panic", "bun-crash"];
  const specs = "e2e/rbac.spec.ts e2e/servers.spec.ts";
  const expectedInvocation = [
    "run",
    "test:e2e:main",
    "--",
    "e2e/rbac.spec.ts",
    "e2e/servers.spec.ts"
  ];

  for (const crashOutcome of crashOutcomes) {
    const result = runWrapper({ outcomes: [crashOutcome, "success"], specs });

    expect(result.exitCode).toBe(0);
    expect(result.invocations).toEqual([expectedInvocation, expectedInvocation]);
    expect(result.log).toContain("retrying this E2E lane once");
    expect(result.log).toContain("lane attempt 2 passed");
  }
});

test("returns the second failure after a Bun crash without a third attempt", () => {
  const result = runWrapper({ outcomes: ["bun-crash", "bun-crash"] });

  expect(result.exitCode).toBe(139);
  expect(result.invocations).toHaveLength(2);
  expect(result.log).toContain("oh no: Bun has crashed on attempt 1");
  expect(result.log).toContain("oh no: Bun has crashed on attempt 2");
  expect(result.log.match(/retrying this E2E lane once/g)).toHaveLength(1);
});
