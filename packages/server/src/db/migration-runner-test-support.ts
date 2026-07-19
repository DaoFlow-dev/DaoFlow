import type pg from "pg";
import { vi } from "vitest";

export function createPool(client: pg.PoolClient) {
  return {
    pool: { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool
  };
}

export function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
