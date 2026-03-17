import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { auth } from "../auth";

type PendingCliAuthRequest = {
  requestId: string;
  userCode: string;
  exchangeCode: string | null;
  sessionToken: string | null;
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
  approvedByEmail: string | null;
  exchangedAt: number | null;
};

const REQUEST_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 2;
const cliAuthRouter = new Hono();
const pendingCliAuthRequests = new Map<string, PendingCliAuthRequest>();

function createUserCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function createExchangeCode(): string {
  return `dfcli_${randomBytes(12).toString("hex")}`;
}

function cleanupExpiredRequests(now = Date.now()) {
  for (const [requestId, request] of pendingCliAuthRequests.entries()) {
    if (request.expiresAt <= now || request.exchangedAt !== null) {
      pendingCliAuthRequests.delete(requestId);
    }
  }
}

function getRequest(requestId: string, userCode: string) {
  cleanupExpiredRequests();
  const request = pendingCliAuthRequests.get(requestId);
  if (!request) {
    return null;
  }

  if (request.userCode !== userCode || request.expiresAt <= Date.now()) {
    return null;
  }

  return request;
}

function extractSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(/(?:^|;\s*)better-auth\.session_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function buildLoginUrl(request: Request) {
  const currentUrl = new URL(request.url);
  const loginUrl = new URL("/login", currentUrl);

  if (currentUrl.hostname === "localhost" && currentUrl.port === "3000") {
    loginUrl.port = "5173";
  }

  loginUrl.searchParams.set("next", currentUrl.toString());
  return loginUrl.toString();
}

function devicePageHtml(input: { title: string; body: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${input.title}</title>
    <style>
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, sans-serif;
        background: #f5f1e8;
        color: #1f2937;
      }
      main {
        max-width: 42rem;
        margin: 4rem auto;
        padding: 2rem;
        background: #fffaf2;
        border: 1px solid #d6cfc1;
        border-radius: 18px;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
      }
      code {
        display: inline-block;
        padding: 0.2rem 0.45rem;
        border-radius: 8px;
        background: #f0e6d6;
        font-weight: 700;
        letter-spacing: 0.06em;
      }
      .stack {
        display: grid;
        gap: 1rem;
      }
      .actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-top: 1rem;
      }
      button,
      a {
        appearance: none;
        border: 0;
        border-radius: 999px;
        background: #1f2937;
        color: white;
        text-decoration: none;
        padding: 0.8rem 1.1rem;
        font: inherit;
        cursor: pointer;
      }
      a.secondary,
      button.secondary {
        background: #d6cfc1;
        color: #1f2937;
      }
      p {
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main class="stack">
      ${input.body}
    </main>
  </body>
</html>`;
}

cliAuthRouter.post("/start", (c) => {
  cleanupExpiredRequests();

  const requestId = randomUUID();
  const userCode = createUserCode();
  const expiresAt = Date.now() + REQUEST_TTL_MS;
  const verificationUri = new URL(`/cli/auth/device`, c.req.url);
  verificationUri.searchParams.set("requestId", requestId);
  verificationUri.searchParams.set("userCode", userCode);

  pendingCliAuthRequests.set(requestId, {
    requestId,
    userCode,
    exchangeCode: null,
    sessionToken: null,
    createdAt: Date.now(),
    expiresAt,
    approvedAt: null,
    approvedByEmail: null,
    exchangedAt: null
  });

  return c.json({
    ok: true,
    requestId,
    userCode,
    verificationUri: verificationUri.toString(),
    intervalSeconds: POLL_INTERVAL_SECONDS,
    expiresAt: new Date(expiresAt).toISOString()
  });
});

cliAuthRouter.get("/status", (c) => {
  const requestId = c.req.query("requestId") ?? "";
  const userCode = c.req.query("userCode") ?? "";
  const request = getRequest(requestId, userCode);

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
  const request = getRequest(body?.requestId ?? "", body?.userCode ?? "");

  if (!request || !body?.exchangeCode || body.exchangeCode !== request.exchangeCode) {
    return c.json({ ok: false, error: "Invalid CLI auth code", code: "INVALID_CODE" }, 400);
  }

  if (!request.sessionToken) {
    return c.json({ ok: false, error: "CLI auth request is not approved", code: "NOT_READY" }, 409);
  }

  request.exchangedAt = Date.now();

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
  const request = getRequest(requestId, userCode);

  if (!request) {
    const payload = { ok: false, error: "CLI auth request not found", code: "NOT_FOUND" };
    return wantsJson
      ? c.json(payload, 404)
      : c.html(
          devicePageHtml({
            title: "Request expired",
            body: `<h1>Request expired</h1><p>The CLI login request is no longer valid. Start a new <code>daoflow login --sso</code> session.</p>`
          }),
          404
        );
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const sessionToken = extractSessionToken(c.req.header("cookie") ?? null);

  if (!session || !sessionToken) {
    const loginUrl = buildLoginUrl(c.req.raw);
    const bodyHtml = `<h1>Sign in to DaoFlow</h1>
<p>This CLI login request is waiting for approval.</p>
<p>User code: <code>${request.userCode}</code></p>
<div class="actions">
  <a href="${loginUrl}">Open DaoFlow Login</a>
  <a class="secondary" href="${new URL(c.req.url).toString()}">Refresh</a>
</div>`;
    return wantsJson
      ? c.json(
          { ok: false, error: "Sign in required before approving CLI auth", code: "AUTH_REQUIRED" },
          401
        )
      : c.html(devicePageHtml({ title: "Sign in required", body: bodyHtml }), 401);
  }

  request.exchangeCode = createExchangeCode();
  request.sessionToken = sessionToken;
  request.approvedAt = Date.now();
  request.approvedByEmail = session.user.email;

  const payload = {
    ok: true,
    exchangeCode: request.exchangeCode,
    approvedByEmail: session.user.email,
    expiresAt: new Date(request.expiresAt).toISOString()
  };

  if (wantsJson) {
    return c.json(payload);
  }

  return c.html(
    devicePageHtml({
      title: "CLI approved",
      body: `<h1>DaoFlow CLI approved</h1>
<p>Approved as <strong>${session.user.email}</strong>.</p>
<p>If your terminal did not pick this up automatically, paste this one-time CLI code:</p>
<p><code>${request.exchangeCode}</code></p>
<p>You can close this page after the terminal confirms the login.</p>`
    })
  );
});

cliAuthRouter.get("/device", async (c) => {
  const requestId = c.req.query("requestId") ?? "";
  const userCode = c.req.query("userCode") ?? "";
  const request = getRequest(requestId, userCode);

  if (!request) {
    return c.html(
      devicePageHtml({
        title: "Request expired",
        body: `<h1>Request expired</h1><p>The CLI login request is no longer valid. Start a new <code>daoflow login --sso</code> session.</p>`
      }),
      404
    );
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    const loginUrl = buildLoginUrl(c.req.raw);
    return c.html(
      devicePageHtml({
        title: "Sign in required",
        body: `<h1>Approve DaoFlow CLI login</h1>
<p>User code: <code>${request.userCode}</code></p>
<p>Sign in to DaoFlow in this browser, then come back to approve this CLI session.</p>
<div class="actions">
  <a href="${loginUrl}">Open DaoFlow Login</a>
  <a class="secondary" href="${new URL(c.req.url).toString()}">Refresh</a>
</div>`
      })
    );
  }

  return c.html(
    devicePageHtml({
      title: "Approve DaoFlow CLI login",
      body: `<h1>Approve DaoFlow CLI login</h1>
<p>Signed in as <strong>${session.user.email}</strong>.</p>
<p>User code: <code>${request.userCode}</code></p>
<form method="post" action="/api/v1/cli-auth/approve">
  <input type="hidden" name="requestId" value="${request.requestId}" />
  <input type="hidden" name="userCode" value="${request.userCode}" />
  <div class="actions">
    <button type="submit">Approve CLI login</button>
    <a class="secondary" href="${new URL(c.req.url).toString()}">Refresh</a>
  </div>
</form>`
    })
  );
});

export { cliAuthRouter };
