import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";
import type { AuthSession } from "./auth";

export interface Context {
  requestId: string;
  session: AuthSession;
}

export async function createContext(opts: { req: Request; res: Response }): Promise<Context> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(opts.req.headers)
  });

  return {
    requestId: String(opts.res.locals.requestId ?? opts.req.header("x-request-id") ?? "unknown"),
    session
  };
}
