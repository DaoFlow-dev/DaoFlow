import { Hono } from "hono";
import { auth } from "../auth";
import {
  approveCliAuthRequest,
  createCliAuthRequest,
  getCliAuthRequest,
  markCliAuthRequestExchanged,
  POLL_INTERVAL_SECONDS
} from "./cli-auth-state";
import {
  buildCliAuthLoginUrl,
  renderCliAuthApprovedPage,
  renderCliAuthDeviceApprovePage,
  renderCliAuthDeviceNeedsSignIn,
  renderCliAuthExpiredPage,
  renderCliAuthSignInPage
} from "./cli-auth-page";

const cliAuthRouter = new Hono();

function extractSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(/(?:^|;\s*)better-auth\.session_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

cliAuthRouter.post("/start", (c) => {
  const request = createCliAuthRequest();
  const verificationUri = new URL(`/cli/auth/device`, c.req.url);
  verificationUri.searchParams.set("requestId", request.requestId);
  verificationUri.searchParams.set("userCode", request.userCode);

  return c.json({
    ok: true,
    requestId: request.requestId,
    userCode: request.userCode,
    verificationUri: verificationUri.toString(),
    intervalSeconds: POLL_INTERVAL_SECONDS,
    expiresAt: new Date(request.expiresAt).toISOString()
  });
});

cliAuthRouter.get("/status", (c) => {
  const requestId = c.req.query("requestId") ?? "";
  const userCode = c.req.query("userCode") ?? "";
  const request = getCliAuthRequest(requestId, userCode);

  if (!request) {
    return c.json({ ok: false, error: "CLI auth request not found", code: "NOT_FOUND" }, 404);
  }

  return c.json({
    ok: true,
    status: request.exchangeCode ? "approved" : "pending",
    exchangeCode: request.exchangeCode,
    approvedByEmail: request.approvedByEmail,
    expiresAt: new Date(request.expiresAt).toISOString()
  });
});

cliAuthRouter.post("/exchange", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    requestId?: string;
    userCode?: string;
    exchangeCode?: string;
  } | null;
  const request = getCliAuthRequest(body?.requestId ?? "", body?.userCode ?? "");

  if (!request || !body?.exchangeCode || body.exchangeCode !== request.exchangeCode) {
    return c.json({ ok: false, error: "Invalid CLI auth code", code: "INVALID_CODE" }, 400);
  }

  if (!request.sessionToken) {
    return c.json({ ok: false, error: "CLI auth request is not approved", code: "NOT_READY" }, 409);
  }

  markCliAuthRequestExchanged(request);

  return c.json({
    ok: true,
    token: request.sessionToken,
    approvedByEmail: request.approvedByEmail
  });
});

cliAuthRouter.post("/approve", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  const wantsJson = (c.req.header("accept") ?? "").includes("application/json");

  const body = contentType.includes("application/json")
    ? ((await c.req.json().catch(() => null)) as { requestId?: string; userCode?: string } | null)
    : await c.req.parseBody();

  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const userCode = typeof body?.userCode === "string" ? body.userCode : "";
  const request = getCliAuthRequest(requestId, userCode);

  if (!request) {
    const payload = { ok: false, error: "CLI auth request not found", code: "NOT_FOUND" };
    return wantsJson ? c.json(payload, 404) : c.html(renderCliAuthExpiredPage(), 404);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const sessionToken = extractSessionToken(c.req.header("cookie") ?? null);

  if (!session || !sessionToken) {
    const loginUrl = buildCliAuthLoginUrl(c.req.raw);
    const refreshUrl = new URL(c.req.url).toString();
    return wantsJson
      ? c.json(
          { ok: false, error: "Sign in required before approving CLI auth", code: "AUTH_REQUIRED" },
          401
        )
      : c.html(renderCliAuthSignInPage(request.userCode, loginUrl, refreshUrl), 401);
  }

  approveCliAuthRequest(request, sessionToken, session.user.email);
  const exchangeCode = request.exchangeCode;

  if (!exchangeCode) {
    return c.json(
      {
        ok: false,
        error: "CLI auth approval did not produce an exchange code",
        code: "INTERNAL_ERROR"
      },
      500
    );
  }

  const payload = {
    ok: true,
    exchangeCode,
    approvedByEmail: session.user.email,
    expiresAt: new Date(request.expiresAt).toISOString()
  };

  if (wantsJson) {
    return c.json(payload);
  }

  return c.html(renderCliAuthApprovedPage(session.user.email, exchangeCode));
});

cliAuthRouter.get("/device", async (c) => {
  const requestId = c.req.query("requestId") ?? "";
  const userCode = c.req.query("userCode") ?? "";
  const request = getCliAuthRequest(requestId, userCode);

  if (!request) {
    return c.html(renderCliAuthExpiredPage(), 404);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    const loginUrl = buildCliAuthLoginUrl(c.req.raw);
    const refreshUrl = new URL(c.req.url).toString();
    return c.html(renderCliAuthDeviceNeedsSignIn(request, loginUrl, refreshUrl));
  }

  return c.html(
    renderCliAuthDeviceApprovePage(request, session.user.email, new URL(c.req.url).toString())
  );
});

export { cliAuthRouter };
