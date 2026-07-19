export async function runWithRequiredCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
  failureMessage: string
): Promise<T> {
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  let cleanupError: unknown;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (operationError && cleanupError) {
    const operationFailure = asError(operationError);
    const cleanupFailure = asError(cleanupError);
    throw new AggregateError(
      [operationFailure, cleanupFailure],
      `${failureMessage} Operation: ${operationFailure.message} Cleanup: ${cleanupFailure.message}`
    );
  }
  if (cleanupError) throw asError(cleanupError);
  if (operationError) throw asError(operationError);
  return result as T;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Operation failed with a non-error value.");
}
