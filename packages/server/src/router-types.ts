import type { appRouter } from "./router";

export type AppRouter = typeof appRouter;

type Assert<T extends true> = T;
type AppRouterProcedurePaths = keyof typeof appRouter._def.procedures;

// React's tRPC client turns a broad router record into a built-in-method
// collision union. Keep the public router's procedure paths concrete.
type _AppRouterProcedurePathsMustRemainConcrete = Assert<
  string extends AppRouterProcedurePaths ? false : true
>;
