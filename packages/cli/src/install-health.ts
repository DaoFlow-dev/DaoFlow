import type { InstallerRuntime } from "./installer-lifecycle";

export const TEMPORAL_WORKER_CONNECTED_DETAIL = "Temporal execution worker connected.";

export async function waitForInstallHealth(input: {
  runtime: Pick<InstallerRuntime, "fetch" | "sleep">;
  port: number;
  attempts?: number;
  intervalMs?: number;
  requiredWorkerDetail?: string;
}): Promise<boolean> {
  const attempts = input.attempts ?? 30;
  const intervalMs = input.intervalMs ?? 2000;

  for (let i = 0; i < attempts; i++) {
    try {
      const response = await input.runtime.fetch(`http://127.0.0.1:${input.port}/ready`);
      if (
        response.ok &&
        (input.requiredWorkerDetail === undefined ||
          (await hasWorkerReadinessDetail(response, input.requiredWorkerDetail)))
      ) {
        return true;
      }
    } catch {
      // Not ready yet.
    }

    await input.runtime.sleep(intervalMs);
  }

  return false;
}

async function hasWorkerReadinessDetail(response: Response, detail: string): Promise<boolean> {
  const body = (await response.json()) as unknown;
  if (!body || typeof body !== "object" || !Array.isArray((body as { checks?: unknown }).checks)) {
    return false;
  }

  return (body as { checks: unknown[] }).checks.some(
    (check) =>
      Boolean(check) &&
      typeof check === "object" &&
      (check as { name?: unknown }).name === "workers" &&
      (check as { detail?: unknown }).detail === detail
  );
}
