import type { Request, Response } from "express";

export function createRequestId() {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveRequestId(req: Request, res: Response) {
  return String(res.locals.requestId ?? req.header("x-request-id") ?? createRequestId());
}
