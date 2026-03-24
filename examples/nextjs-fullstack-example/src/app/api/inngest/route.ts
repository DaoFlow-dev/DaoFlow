import { serve } from "inngest/next";
import { inngest, welcomeEmailFunction } from "@/lib/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [welcomeEmailFunction]
});
