import type { AppTemplateDefinition } from "./app-template-types";

export const applicationAppTemplates = [
  {
    slug: "n8n",
    name: "n8n",
    category: "application",
    summary:
      "Self-hosted n8n automation with a durable data volume, domain metadata, and an encryption key.",
    description:
      "Use this for a lightweight automation control plane where operators want one container, one persistent volume, and explicit external webhook origin settings.",
    tags: ["n8n", "automation", "workflow"],
    defaultProjectName: "n8n",
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
  },
  {
    slug: "fizzy",
    name: "Fizzy",
    category: "application",
    summary: "Basecamp Fizzy with built-in TLS, SMTP delivery, and persistent Rails storage.",
    description:
      "Use this when you want the documented single-container Fizzy deployment, including automatic TLS on the app domain and durable storage for the bundled SQLite-backed app state.",
    tags: ["fizzy", "basecamp", "rails", "social"],
    defaultProjectName: "fizzy",
    services: [
      {
        name: "web",
        role: "app",
        summary: "Fizzy web application with automatic TLS handling on ports 80 and 443."
      }
    ],
    fields: [
      {
        key: "fizzy_domain",
        label: "Public domain",
        kind: "domain",
        description: "Domain Fizzy uses for TLS certificate issuance and canonical links.",
        required: true,
        exampleValue: "fizzy.example.com"
      },
      {
        key: "fizzy_secret_key_base",
        label: "Secret key base",
        kind: "secret",
        description: "Long random secret used by Rails for signed and encrypted data.",
        required: true,
        exampleValue: "replace-with-a-generated-rails-secret"
      },
      {
        key: "fizzy_mailer_from_address",
        label: "Mailer from address",
        kind: "string",
        description: "From address used for sign-in and summary emails.",
        required: true,
        exampleValue: "fizzy@example.com"
      },
      {
        key: "fizzy_smtp_address",
        label: "SMTP server",
        kind: "string",
        description: "Hostname for the SMTP provider Fizzy sends through.",
        required: true,
        exampleValue: "smtp.postmarkapp.com"
      },
      {
        key: "fizzy_smtp_port",
        label: "SMTP port",
        kind: "port",
        description: "SMTP port used for outbound email delivery.",
        required: true,
        defaultValue: "587"
      },
      {
        key: "fizzy_smtp_username",
        label: "SMTP username",
        kind: "string",
        description: "Credential username for the SMTP provider.",
        required: true,
        exampleValue: "postmark-server-token"
      },
      {
        key: "fizzy_smtp_password",
        label: "SMTP password",
        kind: "secret",
        description: "Credential password or API token for the SMTP provider.",
        required: true,
        exampleValue: "replace-with-an-smtp-secret"
      }
    ],
    volumes: [
      {
        nameTemplate: "{{STACK_NAME}}-fizzy-storage",
        mountPath: "/rails/storage",
        summary: "Persistent storage for the bundled database, uploads, and generated assets."
      }
    ],
    healthChecks: [
      {
        serviceName: "web",
        summary: "Runs a local Ruby HTTP probe against the in-container root endpoint.",
        readinessHint:
          "Fizzy manages TLS itself here, so keep ports 80 and 443 available on the target host."
      }
    ],
    composeTemplate: `name: {{STACK_NAME}}
services:
  web:
    image: ghcr.io/basecamp/fizzy:main
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      SECRET_KEY_BASE: "{{FIZZY_SECRET_KEY_BASE}}"
      TLS_DOMAIN: "{{FIZZY_DOMAIN}}"
      BASE_URL: "https://{{FIZZY_DOMAIN}}"
      MAILER_FROM_ADDRESS: "{{FIZZY_MAILER_FROM_ADDRESS}}"
      SMTP_ADDRESS: "{{FIZZY_SMTP_ADDRESS}}"
      SMTP_PORT: "{{FIZZY_SMTP_PORT}}"
      SMTP_USERNAME: "{{FIZZY_SMTP_USERNAME}}"
      SMTP_PASSWORD: "{{FIZZY_SMTP_PASSWORD}}"
    volumes:
      - "{{STACK_NAME}}-fizzy-storage:/rails/storage"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "ruby -rnet/http -e 'response = Net::HTTP.get_response(URI(\\"http://127.0.0.1/\\")); exit((response.is_a?(Net::HTTPSuccess) || response.is_a?(Net::HTTPRedirection)) ? 0 : 1)'"
        ]
      interval: 20s
      timeout: 10s
      retries: 5
volumes:
  {{STACK_NAME}}-fizzy-storage:
`
  },
  {
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
  }
] as const satisfies readonly AppTemplateDefinition[];
