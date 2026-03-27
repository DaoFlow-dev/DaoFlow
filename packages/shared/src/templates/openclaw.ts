import type { AppTemplateDefinition } from "../app-template-types";

export const openclawTemplate = {
  slug: "openclaw",
  name: "OpenClaw",
  category: "application",
  summary:
    "Self-hosted OpenClaw AI assistant with persistent config, workspace storage, and gateway authentication.",
  description:
    "Use this to deploy OpenClaw — the open-source personal AI assistant that connects LLMs to local tools, messaging apps, and shell access. Includes a gateway token for secure access and durable volumes for configuration and workspace data.",
  tags: ["openclaw", "ai", "assistant", "agent", "llm"],
  defaultProjectName: "openclaw",
  services: [
    {
      name: "openclaw",
      role: "app",
      summary: "OpenClaw gateway and web dashboard served from port 18789."
    }
  ],
  fields: [
    {
      key: "openclaw_gateway_token",
      label: "Gateway token",
      kind: "secret",
      description:
        "Authentication token required to access the OpenClaw gateway API and dashboard.",
      required: true,
      exampleValue: "replace-with-a-strong-random-token"
    },
    {
      key: "openclaw_port",
      label: "Published port",
      kind: "port",
      description: "Host port that forwards to the OpenClaw dashboard and gateway.",
      required: true,
      defaultValue: "18789"
    }
  ],
  volumes: [
    {
      nameTemplate: "{{STACK_NAME}}-openclaw-config",
      mountPath: "/home/user/.openclaw",
      summary: "OpenClaw configuration, session history, and skill definitions."
    },
    {
      nameTemplate: "{{STACK_NAME}}-openclaw-workspace",
      mountPath: "/home/user/.openclaw/workspace",
      summary: "Agent workspace for file operations, code generation, and task artifacts."
    }
  ],
  healthChecks: [
    {
      serviceName: "openclaw",
      summary: "Fetches the gateway health endpoint from inside the container.",
      readinessHint:
        "The gateway token must match when connecting clients or messaging integrations."
    }
  ],
  composeTemplate: `name: {{STACK_NAME}}
services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    restart: unless-stopped
    ports:
      - "{{OPENCLAW_PORT}}:18789"
    environment:
      OPENCLAW_GATEWAY_TOKEN: "{{OPENCLAW_GATEWAY_TOKEN}}"
    volumes:
      - "{{STACK_NAME}}-openclaw-config:/home/user/.openclaw"
      - "{{STACK_NAME}}-openclaw-workspace:/home/user/.openclaw/workspace"
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://127.0.0.1:18789/ || exit 1"]
      interval: 20s
      timeout: 10s
      retries: 5
volumes:
  {{STACK_NAME}}-openclaw-config:
  {{STACK_NAME}}-openclaw-workspace:
`
} as const satisfies AppTemplateDefinition;
