import type { Context as HonoContext } from "hono";
import { auth } from "./auth";
import type { AuthSession } from "./auth";

export interface Context {
  requestId: string;
  session: AuthSession;
}

export async function createContext(c: HonoContext): Promise<Context> {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers
  });

  return {
    requestId:
      (c.get("requestId") as string | undefined) ?? c.req.header("x-request-id") ?? "unknown",
    session
  };
}
