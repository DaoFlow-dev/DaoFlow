import { t } from "./trpc";
import { readRouter } from "./routes/read";
import { planningRouter } from "./routes/planning";
import { commandRouter } from "./routes/command";
import { adminRouter } from "./routes/admin";
import { notificationRouter } from "./routes/notifications";

const observationRouter = t.mergeRouters(readRouter, planningRouter);

export const appRouter = t.mergeRouters(
  observationRouter,
  commandRouter,
  adminRouter,
  notificationRouter
);

export type AppRouter = typeof appRouter;
