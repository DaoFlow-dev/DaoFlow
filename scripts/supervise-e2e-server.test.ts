import { expect, test } from "bun:test";

import {
  isNativeRuntimeTermination,
  superviseE2eServer,
  type ServerExit
} from "./supervise-e2e-server";

function serverExit(code: number | null, signal: NodeJS.Signals | null): ServerExit {
  return { code, signal };
}

test("restarts only native runtime terminations", async () => {
  const exits = [serverExit(null, "SIGILL"), serverExit(132, null), serverExit(1, null)];
  const logs: string[] = [];
  const delays: number[] = [];
  let startCount = 0;

  const result = await superviseE2eServer({
    runServer: async () => {
      const result = exits[startCount];
      startCount += 1;
      return result ?? serverExit(1, null);
    },
    wait: async (delayMs) => {
      delays.push(delayMs);
    },
    log: (message) => logs.push(message),
    isStopping: () => false
  });

  expect(result).toEqual(serverExit(1, null));
  expect(startCount).toBe(3);
  expect(delays).toEqual([750, 750]);
  expect(logs).toEqual([
    "[playwright-e2e-server] Native runtime termination (SIGILL); restarting server (1/2) in 750ms.",
    "[playwright-e2e-server] Native runtime termination (exit code 132); restarting server (2/2) in 750ms."
  ]);
});

test("propagates ordinary application exits and shutdown signals without retrying", async () => {
  for (const result of [serverExit(1, null), serverExit(null, "SIGTERM"), serverExit(0, null)]) {
    let startCount = 0;
    const delays: number[] = [];

    await expect(
      superviseE2eServer({
        runServer: async () => {
          startCount += 1;
          return result;
        },
        wait: async (delayMs) => {
          delays.push(delayMs);
        },
        isStopping: () => false
      })
    ).resolves.toEqual(result);

    expect(startCount).toBe(1);
    expect(delays).toEqual([]);
  }
});

test("stops after the strict native-crash retry budget", async () => {
  const logs: string[] = [];
  let startCount = 0;

  const result = await superviseE2eServer({
    runServer: async () => {
      startCount += 1;
      return serverExit(null, "SIGSEGV");
    },
    wait: async () => undefined,
    log: (message) => logs.push(message),
    maxRestarts: 1,
    restartDelayMs: 1,
    isStopping: () => false
  });

  expect(result).toEqual(serverExit(null, "SIGSEGV"));
  expect(startCount).toBe(2);
  expect(logs.at(-1)).toBe(
    "[playwright-e2e-server] Native runtime termination (SIGSEGV) exhausted the 1-restart limit; propagating failure."
  );
});

test("does not start a new server after shutdown has been requested", async () => {
  let startCount = 0;

  const result = await superviseE2eServer({
    runServer: async () => {
      startCount += 1;
      return serverExit(0, null);
    },
    isStopping: () => true
  });

  expect(result).toEqual(serverExit(1, null));
  expect(startCount).toBe(0);
});

test("recognizes native crash signals and their shell exit-status equivalents", () => {
  expect(isNativeRuntimeTermination(serverExit(null, "SIGABRT"))).toBe(true);
  expect(isNativeRuntimeTermination(serverExit(null, "SIGILL"))).toBe(true);
  expect(isNativeRuntimeTermination(serverExit(null, "SIGSEGV"))).toBe(true);
  expect(isNativeRuntimeTermination(serverExit(132, null))).toBe(true);
  expect(isNativeRuntimeTermination(serverExit(134, null))).toBe(true);
  expect(isNativeRuntimeTermination(serverExit(139, null))).toBe(true);
  expect(isNativeRuntimeTermination(serverExit(null, "SIGTERM"))).toBe(false);
  expect(isNativeRuntimeTermination(serverExit(1, null))).toBe(false);
});
