import type { AppTemplateDefinition } from "../app-template-types";

export const n8nTemplate = {
  slug: "n8n",
  name: "n8n",
  category: "application",
  summary:
    "Self-hosted n8n automation with a durable data volume, domain metadata, and an encryption key.",
  description:
    "Use this for a lightweight automation control plane where operators want one container, one persistent volume, and explicit external webhook origin settings.",
  tags: ["n8n", "automation", "workflow"],
  defaultProjectName: "n8n",
  maintenance: {
    version: "1.84.1",
    sourceName: "n8n Docker docs",
    sourceUrl: "https://docs.n8n.io/hosting/installation/docker/",
    reviewedAt: "2026-03-21T00:00:00.000Z",
    reviewCadenceDays: 90,
    changeNotes: [
      "Pinned the starter to n8n 1.84.1 with the documented webhook and encryption-key settings.",
      "Re-validated the persistent data mount and /healthz readiness probe."
    ]
  },
  services: [
    {
      name: "n8n",
      role: "app",
      summary: "Automation UI and webhook worker served from port 5678."
    }
  ],
  fields: [
    {
      key: "n8n_domain",
      label: "Public domain",
      kind: "domain",
      description: "External domain used for UI access and webhook generation.",
      required: true,
      exampleValue: "n8n.example.com"
    },
    {
      key: "n8n_encryption_key",
      label: "Encryption key",
      kind: "secret",
      description: "Secret used by n8n to encrypt credentials at rest.",
      required: true,
      exampleValue: "replace-with-a-strong-random-key"
    },
    {
      key: "n8n_port",
      label: "Published port",
      kind: "port",
      description: "Host port that forwards to n8n inside the stack.",
      required: true,
      defaultValue: "5678"
    },
    {
      key: "n8n_timezone",
      label: "Timezone",
      kind: "string",
      description: "Timezone for the workflow scheduler and UI display.",
      required: true,
      defaultValue: "UTC"
    }
  ],
  volumes: [
    {
      nameTemplate: "{{STACK_NAME}}-n8n-data",
      mountPath: "/home/node/.n8n",
      summary: "n8n state, credentials, and workflow history."
    }
  ],
  healthChecks: [
    {
      serviceName: "n8n",
      summary: "Checks the local `/healthz` endpoint inside the container.",
      readinessHint:
        "Published-port readiness is the operator-facing health signal for ingress and webhook traffic."
    }
  ],
  composeTemplate: `name: {{STACK_NAME}}
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:1.84.1
    restart: unless-stopped
    ports:
      - "{{N8N_PORT}}:5678"
    environment:
      N8N_HOST: "{{N8N_DOMAIN}}"
      N8N_PROTOCOL: "https"
      WEBHOOK_URL: "https://{{N8N_DOMAIN}}/"
      N8N_ENCRYPTION_KEY: "{{N8N_ENCRYPTION_KEY}}"
      GENERIC_TIMEZONE: "{{N8N_TIMEZONE}}"
    volumes:
      - "{{STACK_NAME}}-n8n-data:/home/node/.n8n"
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://127.0.0.1:5678/healthz || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
volumes:
  {{STACK_NAME}}-n8n-data:
`
} as const satisfies AppTemplateDefinition;
