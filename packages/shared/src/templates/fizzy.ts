import type { AppTemplateDefinition } from "../app-template-types";

export const fizzyTemplate = {
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
          "ruby -rnet/http -e 'response = Net::HTTP.get_response(URI("http://127.0.0.1/")); exit((response.is_a?(Net::HTTPSuccess) || response.is_a?(Net::HTTPRedirection)) ? 0 : 1)'"
        ]
      interval: 20s
      timeout: 10s
      retries: 5
volumes:
  {{STACK_NAME}}-fizzy-storage:
`
} as const satisfies AppTemplateDefinition;
