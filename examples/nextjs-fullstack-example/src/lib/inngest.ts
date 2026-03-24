import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "fullstack-demo",
  eventKey: process.env.INNGEST_EVENT_KEY
});

/** Runs when a user signs up — simulates a welcome email. */
export const welcomeEmailFunction = inngest.createFunction(
  { id: "send-welcome-email", name: "Send Welcome Email" },
  { event: "user/created" },
  async ({ event, step }) => {
    const email = event.data.email as string;
    const name = event.data.name as string;

    await step.run("send-email", async () => {
      // In production, wire up an SMTP transport here.
      console.log(`[inngest] Welcome email sent to ${name} <${email}>`);
      return { sent: true, to: email };
    });

    await step.sleep("wait-1-day", "1d");

    await step.run("send-follow-up", async () => {
      console.log(`[inngest] Follow-up email sent to ${email}`);
      return { sent: true, to: email, type: "follow-up" };
    });
  }
);
