import type { AppTemplateDefinition } from "../app-template-types";

export const uptimeKumaTemplate = {
  slug: "uptime-kuma",
  name: "Uptime Kuma",
  category: "application",
  summary: "Uptime Kuma monitoring with one persistent volume and a simple HTTP readiness probe.",
  description:
    "Use this when operators want a fast, single-service monitoring dashboard with persistent check history and no external database dependency.",
  tags: ["uptime-kuma", "monitoring", "dashboard"],
  defaultProjectName: "uptime-kuma",
  services: [
    {
      name: "uptime-kuma",
      role: "app",
      summary: "Monitoring dashboard served from port 3001."
    }
  ],
  fields: [
    {
      key: "uptime_kuma_port",
      label: "Published port",
      kind: "port",
      description: "Host port that forwards to the Uptime Kuma UI.",
      required: true,
      defaultValue: "3001"
    }
  ],
  volumes: [
    {
      nameTemplate: "{{STACK_NAME}}-uptime-kuma-data",
      mountPath: "/app/data",
      summary: "Monitor definitions, state, and incident history."
    }
  ],
  healthChecks: [
    {
      serviceName: "uptime-kuma",
      summary: "Fetches the root HTTP endpoint from inside the container.",
      readinessHint:
        "Use the published port in DaoFlow-managed readiness probes if you front this behind a reverse proxy."
    }
  ],
  composeTemplate: `name: {{STACK_NAME}}
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    ports:
      - "{{UPTIME_KUMA_PORT}}:3001"
    volumes:
      - "{{STACK_NAME}}-uptime-kuma-data:/app/data"
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://127.0.0.1:3001 || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
volumes:
  {{STACK_NAME}}-uptime-kuma-data:
`
} as const satisfies AppTemplateDefinition;
