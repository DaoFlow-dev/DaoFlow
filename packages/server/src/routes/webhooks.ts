import { Hono } from "hono";
import { handleGitHubWebhook } from "./webhooks-github";
import { handleGitLabWebhook } from "./webhooks-gitlab";

export const webhooksRouter = new Hono();

webhooksRouter.post("/github", handleGitHubWebhook);
webhooksRouter.post("/gitlab", handleGitLabWebhook);
