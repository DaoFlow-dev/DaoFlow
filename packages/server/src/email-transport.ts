/**
 * email-transport.ts — Optional email sending for auth flows (password reset, email verification).
 *
 * Supports two providers, configured via environment variables:
 *
 * ## SMTP (nodemailer)
 * Set all of:
 *   SMTP_ADDRESS, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, MAILER_FROM_ADDRESS
 *
 * ## Resend
 * Set:
 *   RESEND_API_KEY  (required)
 *   RESEND_FROM     (optional, defaults to "DaoFlow <noreply@{RESEND_DOMAIN}>")
 *   RESEND_DOMAIN   (optional, used to build default from address)
 *
 * If neither provider is configured the module exports `null`, and
 * better-auth falls back to its default (no email sending).
 */

import type { BetterAuthOptions } from "better-auth";

// ---------------------------------------------------------------------------
// SMTP transport via nodemailer
// ---------------------------------------------------------------------------

function buildSmtpSendEmail():
  | NonNullable<BetterAuthOptions["emailAndPassword"]>["sendResetPassword"]
  | null {
  const { SMTP_ADDRESS, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, MAILER_FROM_ADDRESS } =
    process.env;

  if (!SMTP_ADDRESS || !SMTP_PORT || !SMTP_USERNAME || !SMTP_PASSWORD || !MAILER_FROM_ADDRESS) {
    return null;
  }

  // Dynamic import so nodemailer is optional at install time
  return async (data) => {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: SMTP_ADDRESS,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD }
    });

    await transport.sendMail({
      from: MAILER_FROM_ADDRESS,
      to: data.user.email,
      subject: "Reset your DaoFlow password",
      html: `
        <p>Hi ${data.user.name ?? "there"},</p>
        <p>Click the link below to reset your password:</p>
        <p><a href="${data.url}">${data.url}</a></p>
        <p>If you did not request this, you can safely ignore this email.</p>
      `
    });
  };
}

// ---------------------------------------------------------------------------
// Resend transport via HTTP API
// ---------------------------------------------------------------------------

function buildResendSendEmail():
  | NonNullable<BetterAuthOptions["emailAndPassword"]>["sendResetPassword"]
  | null {
  const { RESEND_API_KEY, RESEND_FROM, RESEND_DOMAIN } = process.env;

  if (!RESEND_API_KEY) {
    return null;
  }

  const fromAddress = RESEND_FROM ?? `DaoFlow <noreply@${RESEND_DOMAIN ?? "daoflow.app"}>`;

  return async (data) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [data.user.email],
        subject: "Reset your DaoFlow password",
        html: `
          <p>Hi ${data.user.name ?? "there"},</p>
          <p>Click the link below to reset your password:</p>
          <p><a href="${data.url}">${data.url}</a></p>
          <p>If you did not request this, you can safely ignore this email.</p>
        `
      })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error (${res.status}): ${body}`);
    }
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the email sending function for whichever provider is configured.
 * Prefers SMTP if both are set. Returns `undefined` if neither is configured.
 */
export function resolveEmailSender():
  | NonNullable<BetterAuthOptions["emailAndPassword"]>["sendResetPassword"]
  | undefined {
  const smtp = buildSmtpSendEmail();
  if (smtp) {
    console.log(
      "[auth] Email transport: SMTP (%s:%s)",
      process.env.SMTP_ADDRESS,
      process.env.SMTP_PORT
    );
    return smtp;
  }

  const resend = buildResendSendEmail();
  if (resend) {
    console.log("[auth] Email transport: Resend");
    return resend;
  }

  console.log("[auth] Email transport: none configured (password reset emails disabled)");
  return undefined;
}
