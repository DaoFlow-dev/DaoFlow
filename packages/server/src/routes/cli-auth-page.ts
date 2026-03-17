import type { PendingCliAuthRequest } from "./cli-auth-state";

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

export function buildCliAuthLoginUrl(request: Request) {
  const currentUrl = new URL(request.url);
  const loginUrl = new URL("/login", currentUrl);

  if (currentUrl.hostname === "localhost" && currentUrl.port === "3000") {
    loginUrl.port = "5173";
  }

  loginUrl.searchParams.set("next", currentUrl.toString());
  return loginUrl.toString();
}

export function renderCliAuthExpiredPage() {
  return devicePageHtml({
    title: "Request expired",
    body: `<h1>Request expired</h1><p>The CLI login request is no longer valid. Start a new <code>daoflow login --sso</code> session.</p>`
  });
}

export function renderCliAuthSignInPage(userCode: string, loginUrl: string, refreshUrl: string) {
  return devicePageHtml({
    title: "Sign in required",
    body: `<h1>Sign in to DaoFlow</h1>
<p>This CLI login request is waiting for approval.</p>
<p>User code: <code>${userCode}</code></p>
<div class="actions">
  <a href="${loginUrl}">Open DaoFlow Login</a>
  <a class="secondary" href="${refreshUrl}">Refresh</a>
</div>`
  });
}

export function renderCliAuthApprovedPage(email: string, exchangeCode: string) {
  return devicePageHtml({
    title: "CLI approved",
    body: `<h1>DaoFlow CLI approved</h1>
<p>Approved as <strong>${email}</strong>.</p>
<p>If your terminal did not pick this up automatically, paste this one-time CLI code:</p>
<p><code>${exchangeCode}</code></p>
<p>You can close this page after the terminal confirms the login.</p>`
  });
}

export function renderCliAuthDeviceNeedsSignIn(
  request: PendingCliAuthRequest,
  loginUrl: string,
  refreshUrl: string
) {
  return devicePageHtml({
    title: "Sign in required",
    body: `<h1>Approve DaoFlow CLI login</h1>
<p>User code: <code>${request.userCode}</code></p>
<p>Sign in to DaoFlow in this browser, then come back to approve this CLI session.</p>
<div class="actions">
  <a href="${loginUrl}">Open DaoFlow Login</a>
  <a class="secondary" href="${refreshUrl}">Refresh</a>
</div>`
  });
}

export function renderCliAuthDeviceApprovePage(
  request: PendingCliAuthRequest,
  email: string,
  refreshUrl: string
) {
  return devicePageHtml({
    title: "Approve DaoFlow CLI login",
    body: `<h1>Approve DaoFlow CLI login</h1>
<p>Signed in as <strong>${email}</strong>.</p>
<p>User code: <code>${request.userCode}</code></p>
<form method="post" action="/api/v1/cli-auth/approve">
  <input type="hidden" name="requestId" value="${request.requestId}" />
  <input type="hidden" name="userCode" value="${request.userCode}" />
  <div class="actions">
    <button type="submit">Approve CLI login</button>
    <a class="secondary" href="${refreshUrl}">Refresh</a>
  </div>
</form>`
  });
}
