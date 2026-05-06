import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { updateDevelopmentTaskRun } from "../db/services/development-tasks";
import {
  executeDevelopmentTaskCodex,
  type DevelopmentTaskCodexExecutionResult
} from "./development-task-codex-execution";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  readDevelopmentTaskValidationCommands,
  runDevelopmentTaskValidation,
  type DevelopmentTaskValidationResult
} from "./development-task-validation";

let codexExecution = executeDevelopmentTaskCodex;
let validationExecution = runDevelopmentTaskValidation;

export async function runClaimedTaskCodex(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  plan: DevelopmentTaskCodexPlan;
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  metadata: Record<string, unknown>;
}) {
  await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "coding",
    metadata: {
      ...input.metadata,
      codexExecution: {
        status: "started",
        logPath: `${input.workspace.logsPath}/codex-exec.jsonl`
      }
    }
  });

  const execution = await codexExecution({
    plan: input.plan,
    workspace: input.workspace,
    onLog: (line) => {
      console.log(`[development-task-codex:${line.stream}] ${line.message}`);
    }
  }).catch((err: unknown): DevelopmentTaskCodexExecutionResult => {
    return {
      status: "failed",
      exitCode: 1,
      logPath: `${input.workspace.logsPath}/codex-exec.jsonl`,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  });

  if (execution.status !== "ok") {
    await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "codex_execution_failed",
      failureMessage: execution.errorMessage ?? "Codex execution failed.",
      metadata: {
        ...input.metadata,
        codexExecution: execution
      }
    });
    return;
  }

  await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "validating",
    metadata: {
      ...input.metadata,
      codexExecution: execution,
      validation: {
        status: "started",
        logPath: `${input.workspace.logsPath}/validation.jsonl`
      }
    }
  });

  const validation = await validationExecution({
    workspace: input.workspace,
    commands: readDevelopmentTaskValidationCommands(input.metadata),
    onLog: (line) => {
      console.log(`[development-task-validation:${line.stream}] ${line.message}`);
    }
  }).catch((err: unknown): DevelopmentTaskValidationResult => {
    return {
      status: "failed",
      commands: readDevelopmentTaskValidationCommands(input.metadata),
      logPath: `${input.workspace.logsPath}/validation.jsonl`,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  });

  if (validation.status === "failed") {
    await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "validation_failed",
      failureMessage: validation.errorMessage ?? "Development task validation failed.",
      metadata: {
        ...input.metadata,
        codexExecution: execution,
        validation
      }
    });
    return;
  }

  await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "opening_pr",
    metadata: {
      ...input.metadata,
      codexExecution: execution,
      validation
    }
  });
}

export function setDevelopmentTaskCodexExecutionForTests(next: typeof executeDevelopmentTaskCodex) {
  codexExecution = next;
}

export function resetDevelopmentTaskCodexExecutionForTests() {
  codexExecution = executeDevelopmentTaskCodex;
}

export function setDevelopmentTaskValidationExecutionForTests(
  next: typeof runDevelopmentTaskValidation
) {
  validationExecution = next;
}

export function resetDevelopmentTaskValidationExecutionForTests() {
  validationExecution = runDevelopmentTaskValidation;
}
