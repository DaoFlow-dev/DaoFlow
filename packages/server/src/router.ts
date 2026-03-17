import { t } from "./trpc";
import { readRouter } from "./routes/read";
import { commandRouter } from "./routes/command";
import { adminRouter } from "./routes/admin";
import { notificationRouter } from "./routes/notifications";

export const appRouter = t.mergeRouters(readRouter, commandRouter, adminRouter, notificationRouter);

export type AppRouter = typeof appRouter;
