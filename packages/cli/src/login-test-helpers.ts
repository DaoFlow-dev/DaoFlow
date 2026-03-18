export class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

export async function captureCommandExecution(
  run: () => Promise<void>
): Promise<{ logs: string[]; errors: string[]; exitCode: number | null }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit.bind(process);
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;

  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(" "));
  };
  process.exit = ((code?: number) => {
    throw new ExitSignal(code ?? 0);
  }) as typeof process.exit;

  try {
    await run();
  } catch (error) {
    if (error instanceof ExitSignal) {
      exitCode = error.code;
    } else {
      throw error;
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return { logs, errors, exitCode };
}
