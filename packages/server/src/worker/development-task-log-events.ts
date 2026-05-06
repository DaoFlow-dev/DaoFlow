import { recordDevelopmentTaskEvent } from "../db/services/development-tasks";
import type { LogLine } from "./docker-exec-shared";

const DEFAULT_MAX_LOG_EVENTS = 200;
const SUMMARY_LIMIT = 160;
const DETAIL_LIMIT = 4_000;

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

export function createDevelopmentTaskLogEventStream(input: {
  taskId: string;
  runId: string;
  phase: "codex" | "validation";
  maxEvents?: number;
}) {
  const maxEvents = input.maxEvents ?? DEFAULT_MAX_LOG_EVENTS;
  const pending: Array<Promise<void>> = [];
  let recorded = 0;
  let dropped = 0;

  function record(line: LogLine) {
    if (recorded >= maxEvents) {
      dropped += 1;
      return;
    }

    recorded += 1;
    pending.push(
      recordDevelopmentTaskEvent({
        taskId: input.taskId,
        runId: input.runId,
        kind: `${input.phase}.log`,
        summary: truncate(`${input.phase} ${line.stream}: ${line.message}`, SUMMARY_LIMIT),
        detail: truncate(line.message, DETAIL_LIMIT),
        metadata: {
          phase: input.phase,
          stream: line.stream,
          timestamp: line.timestamp.toISOString()
        }
      }).then(
        () => undefined,
        (err: unknown) => {
          console.error(
            `[development-task-${input.phase}] Failed to record log event:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      )
    );
  }

  async function flush() {
    await Promise.all(pending);
    if (dropped > 0) {
      await recordDevelopmentTaskEvent({
        taskId: input.taskId,
        runId: input.runId,
        kind: `${input.phase}.log.truncated`,
        summary: `Skipped ${dropped} additional ${input.phase} log events.`,
        metadata: {
          phase: input.phase,
          dropped,
          maxEvents
        }
      }).catch((err: unknown) => {
        console.error(
          `[development-task-${input.phase}] Failed to record log truncation event:`,
          err instanceof Error ? err.message : String(err)
        );
      });
    }
  }

  return { record, flush };
}
