import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import { prepareDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";

function testPlan(workspaceRoot: string): DevelopmentTaskCodexPlan {
  const runRoot = path.posix.join(workspaceRoot, "run_123");
  const codexHomePath = path.posix.join(runRoot, "home/.codex");
  const repoPath = path.posix.join(runRoot, "repo");
  const artifactsPath = path.posix.join(runRoot, "artifacts");
  const logsPath = path.posix.join(runRoot, "logs");
  const prompt = "Task:\n- Do the work\n\nSafety rules:\n- Do not expose secrets.";

  return {
    codexHomePath,
    configPath: path.posix.join(codexHomePath, "config.toml"),
    authJsonPath: path.posix.join(codexHomePath, "auth.json"),
    repoPath,
    artifactsPath,
    logsPath,
    codexAuthMode: "custom_provider_env",
    codexAuthJsonEnvKey: "CODEX_AUTH_JSON",
    defaultCodexHomePath: "/runner/home/.codex",
    configToml: 'profile = "daoflow"',
    prompt,
    command: "codex",
    args: ["exec", "--json", "--profile", "daoflow", "--cd", repoPath, prompt],
    env: {
      CODEX_HOME: codexHomePath,
      DAOFLOW_TASK_ID: "task_123",
      DAOFLOW_RUN_ID: "run_123"
    }
  };
}

describe("development task Codex workspace", () => {
  afterEach(() => {
    delete process.env.CODEX_AUTH_JSON;
    delete process.env.DAOFLOW_TEST_CODEX_AUTH_JSON;
  });

  it("writes config, prompt, logs, artifacts, and a redacted run plan", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "daoflow-codex-workspace-"));
    const plan = testPlan(workspaceRoot);

    const prepared = await prepareDevelopmentTaskCodexWorkspace(plan);

    expect(prepared).toMatchObject({
      codexHomePath: plan.codexHomePath,
      configPath: plan.configPath,
      repoPath: plan.repoPath,
      artifactsPath: plan.artifactsPath,
      logsPath: plan.logsPath
    });

    expect((await stat(plan.repoPath)).isDirectory()).toBe(true);
    expect((await stat(plan.logsPath)).isDirectory()).toBe(true);
    await expect(readFile(plan.configPath, "utf8")).resolves.toBe('profile = "daoflow"\n');
    await expect(readFile(prepared.promptPath, "utf8")).resolves.toBe(`${plan.prompt}\n`);

    const configMode = (await stat(plan.configPath)).mode & 0o777;
    const promptMode = (await stat(prepared.promptPath)).mode & 0o777;
    const runPlanMode = (await stat(prepared.runPlanPath)).mode & 0o777;

    expect(configMode).toBe(0o600);
    expect(promptMode).toBe(0o600);
    expect(runPlanMode).toBe(0o600);

    const runPlan = JSON.parse(await readFile(prepared.runPlanPath, "utf8")) as {
      args: string[];
      env: Record<string, string>;
      paths: { promptPath: string; authJsonPath: string };
      codexAuthMode: string;
    };
    expect(runPlan.args).toContain(`@${prepared.promptPath}`);
    expect(runPlan.args).not.toContain(plan.prompt);
    expect(JSON.stringify(runPlan)).not.toContain("Do not expose secrets");
    expect(runPlan.env).toEqual(plan.env);
    expect(runPlan.paths.promptPath).toBe(prepared.promptPath);
    expect(runPlan.paths.authJsonPath).toBe(plan.authJsonPath);
    expect(runPlan.codexAuthMode).toBe("custom_provider_env");
  });

  it("materializes ChatGPT auth JSON from an environment variable", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "daoflow-codex-auth-"));
    const plan = {
      ...testPlan(workspaceRoot),
      codexAuthMode: "chatgpt_auth_json" as const,
      codexAuthJsonEnvKey: "DAOFLOW_TEST_CODEX_AUTH_JSON"
    };
    process.env.DAOFLOW_TEST_CODEX_AUTH_JSON = JSON.stringify({
      tokens: { id_token: "redacted" }
    });

    const prepared = await prepareDevelopmentTaskCodexWorkspace(plan);

    await expect(readFile(prepared.authJsonPath, "utf8")).resolves.toContain("id_token");
    expect((await stat(prepared.authJsonPath)).mode & 0o777).toBe(0o600);
    const runPlan = await readFile(prepared.runPlanPath, "utf8");
    expect(runPlan).toContain("chatgpt_auth_json");
    expect(runPlan).toContain("DAOFLOW_TEST_CODEX_AUTH_JSON");
    expect(runPlan).not.toContain("id_token");
  });

  it("fails early when ChatGPT auth JSON is missing or malformed", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "daoflow-codex-auth-missing-"));
    const plan = {
      ...testPlan(workspaceRoot),
      codexAuthMode: "chatgpt_auth_json" as const,
      codexAuthJsonEnvKey: "DAOFLOW_TEST_CODEX_AUTH_JSON"
    };

    await expect(prepareDevelopmentTaskCodexWorkspace(plan)).rejects.toThrow(
      "DAOFLOW_TEST_CODEX_AUTH_JSON is required"
    );

    process.env.DAOFLOW_TEST_CODEX_AUTH_JSON = "not json";
    await expect(prepareDevelopmentTaskCodexWorkspace(plan)).rejects.toThrow(
      "DAOFLOW_TEST_CODEX_AUTH_JSON must contain valid Codex auth JSON"
    );
  });
});
