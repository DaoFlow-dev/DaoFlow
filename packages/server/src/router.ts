import { t } from "./trpc";
import { readRouter } from "./routes/read";
import { commandRouter } from "./routes/command";
import { adminRouter } from "./routes/admin";

export const appRouter = t.mergeRouters(readRouter, commandRouter, adminRouter);

export type AppRouter = typeof appRouter;
