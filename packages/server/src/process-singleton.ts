type ProcessState = NodeJS.Process & Record<string, unknown>;

export function getProcessSingleton<T>(key: string, initialize: () => T): T {
  const processState = process as ProcessState;
  const existingValue = processState[key] as T | undefined;

  if (existingValue !== undefined) {
    return existingValue;
  }

  const nextValue = initialize();
  processState[key] = nextValue;
  return nextValue;
}

export function getProcessValueAccessor<T>(key: string, initialValue: T) {
  const processState = process as ProcessState & Record<string, T | undefined>;

  if (!(key in processState)) {
    processState[key] = initialValue;
  }

  return {
    get current() {
      return processState[key] as T;
    },
    set current(value: T) {
      processState[key] = value;
    }
  };
}
