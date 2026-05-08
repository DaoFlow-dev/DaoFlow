import { SEVERITY_EMOJI } from "./notification-sender-shared";
import type { NotificationPayload, SendResult } from "./notification-sender-types";

export async function sendEmailNotification(
  channel: { name: string; email: string | null },
  payload: NotificationPayload
): Promise<SendResult> {
  const to = channel.email;
  if (!to) {
    return { ok: false, httpStatus: 0, error: "No recipient email configured" };
  }

  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
  const subject = `${emoji} [DaoFlow] ${payload.title}`;
  const fields = (payload.fields ?? []).map((f) => `  ${f.name}: ${f.value}`).join("\n");
  const body = [
    payload.message,
    fields ? `\nDetails:\n${fields}` : "",
    payload.url ? `\nView: ${payload.url}` : "",
    `\n---\nDaoFlow Notifications`
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { SMTP_ADDRESS, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, MAILER_FROM_ADDRESS } =
      process.env;
    const { RESEND_API_KEY, RESEND_FROM, RESEND_DOMAIN } = process.env;

    if (SMTP_ADDRESS && SMTP_PORT && SMTP_USERNAME && SMTP_PASSWORD && MAILER_FROM_ADDRESS) {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: SMTP_ADDRESS,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
          user: SMTP_USERNAME,
          pass: SMTP_PASSWORD
        }
      });

      await transport.sendMail({
        from: MAILER_FROM_ADDRESS,
        to,
        subject,
        text: body
      });

      return { ok: true, httpStatus: 200 };
    }

    if (RESEND_API_KEY) {
      const from = RESEND_FROM ?? `DaoFlow <noreply@${RESEND_DOMAIN ?? "daoflow.app"}>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify({ from, to: [to], subject, text: body })
      });
      return { ok: res.ok, httpStatus: res.status, error: res.ok ? undefined : await res.text() };
    }

    return {
      ok: false,
      httpStatus: 0,
      error: "No SMTP or Resend email transport is configured"
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    return { ok: false, httpStatus: 0, error: message };
  }
}
