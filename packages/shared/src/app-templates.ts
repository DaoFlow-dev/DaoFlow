export type AppTemplateCategory = "application" | "database" | "cache" | "queue";

export type AppTemplateFieldKind = "string" | "secret" | "domain" | "port";

export interface AppTemplateFieldDefinition {
  key: string;
  label: string;
  kind: AppTemplateFieldKind;
  description: string;
  required?: boolean;
  defaultValue?: string;
  exampleValue?: string;
}

export interface AppTemplateServiceDefinition {
  name: string;
  role: "app" | "database" | "cache" | "queue";
  summary: string;
}

export interface AppTemplateVolumeDefinition {
  nameTemplate: string;
  mountPath: string;
  summary: string;
}

export interface AppTemplateHealthCheckDefinition {
  serviceName: string;
  summary: string;
  readinessHint: string;
}

export interface AppTemplateDefinition {
  slug: string;
  name: string;
  category: AppTemplateCategory;
  summary: string;
  description: string;
  tags: string[];
  defaultProjectName: string;
  services: AppTemplateServiceDefinition[];
  fields: AppTemplateFieldDefinition[];
  volumes: AppTemplateVolumeDefinition[];
  healthChecks: AppTemplateHealthCheckDefinition[];
  composeTemplate: string;
}

export interface RenderedTemplateField extends AppTemplateFieldDefinition {
  value: string;
}

export interface RenderedAppTemplate {
  template: AppTemplateDefinition;
  projectName: string;
  stackName: string;
  compose: string;
  fields: RenderedTemplateField[];
}

const APP_TEMPLATE_DEFINITIONS: readonly AppTemplateDefinition[] = [
  {
    slug: "postgres",
    name: "PostgreSQL",
    category: "database",
    summary: "Single-node PostgreSQL with persistent storage and an explicit health check.",
    description:
      "Use this when an app needs a straightforward stateful Postgres service with one named data volume and operator-supplied credentials.",
    tags: ["postgres", "database", "stateful"],
    defaultProjectName: "postgres",
    services: [
      {
        name: "postgres",
        role: "database",
        summary: "Primary PostgreSQL instance exposed on a configurable host port."
      }
    ],
    fields: [
      {
        key: "postgres_db",
        label: "Database name",
        kind: "string",
        description: "Initial database created on first boot.",
        required: true,
        defaultValue: "app"
      },
      {
        key: "postgres_user",
        label: "Database user",
        kind: "string",
        description: "Primary application user for the database.",
        required: true,
        defaultValue: "app"
      },
      {
        key: "postgres_password",
        label: "Database password",
        kind: "secret",
        description: "Password for the primary database user.",
        required: true,
        exampleValue: "replace-with-a-strong-password"
      },
      {
        key: "postgres_port",
        label: "Published port",
        kind: "port",
        description: "Host port that forwards to PostgreSQL inside the stack.",
        required: true,
        defaultValue: "5432"
      }
    ],
    volumes: [
      {
        nameTemplate: "{{STACK_NAME}}-postgres-data",
        mountPath: "/var/lib/postgresql/data",
        summary: "Database state and WAL files."
      }
    ],
    healthChecks: [
      {
        serviceName: "postgres",
        summary: "Runs `pg_isready` against the configured database and user.",
        readinessHint: "Wait for the container health check before attaching dependent workloads."
      }
    ],
    composeTemplate: `name: {{STACK_NAME}}
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    ports:
      - "{{POSTGRES_PORT}}:5432"
    environment:
      POSTGRES_DB: "{{POSTGRES_DB}}"
      POSTGRES_USER: "{{POSTGRES_USER}}"
      POSTGRES_PASSWORD: "{{POSTGRES_PASSWORD}}"
    volumes:
      - "{{STACK_NAME}}-postgres-data:/var/lib/postgresql/data"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \\"$$POSTGRES_USER\\" -d \\"$$POSTGRES_DB\\""]
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  {{STACK_NAME}}-postgres-data:
`
  },
  {
    slug: "redis",
    name: "Redis",
    category: "cache",
    summary: "Redis with append-only persistence and a required password.",
    description:
      "Use this for cache, rate-limit, and transient coordination workloads where a single Redis node is enough.",
    tags: ["redis", "cache", "queue"],
    defaultProjectName: "redis",
    services: [
      {
        name: "redis",
        role: "cache",
        summary: "Single Redis instance with append-only storage enabled."
      }
    ],
    fields: [
      {
        key: "redis_password",
        label: "Redis password",
        kind: "secret",
        description: "Password required for all Redis clients.",
        required: true,
        exampleValue: "replace-with-a-strong-password"
      },
      {
        key: "redis_port",
        label: "Published port",
        kind: "port",
        description: "Host port that forwards to Redis inside the stack.",
        required: true,
        defaultValue: "6379"
      }
    ],
    volumes: [
      {
        nameTemplate: "{{STACK_NAME}}-redis-data",
        mountPath: "/data",
        summary: "Append-only persistence for Redis state."
      }
    ],
    healthChecks: [
      {
        serviceName: "redis",
        summary: "Authenticates with `redis-cli` and expects `PONG`.",
        readinessHint:
          "Use the published port for external probes; internal health is container-local."
      }
    ],
    composeTemplate: `name: {{STACK_NAME}}
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["sh", "-c", "exec redis-server --appendonly yes --requirepass \\"$$REDIS_PASSWORD\\""]
    environment:
      REDIS_PASSWORD: "{{REDIS_PASSWORD}}"
    ports:
      - "{{REDIS_PORT}}:6379"
    volumes:
      - "{{STACK_NAME}}-redis-data:/data"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \\"$$REDIS_PASSWORD\\" ping | grep PONG"]
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  {{STACK_NAME}}-redis-data:
`
  },
  {
    slug: "rabbitmq",
    name: "RabbitMQ",
    category: "queue",
    summary: "RabbitMQ with the management UI, durable storage, and operator-supplied credentials.",
    description:
      "Use this for message-queue workloads that need both AMQP traffic and a built-in management surface.",
    tags: ["rabbitmq", "queue", "broker"],
    defaultProjectName: "rabbitmq",
    services: [
      {
        name: "rabbitmq",
        role: "queue",
        summary: "RabbitMQ broker with the management plugin enabled."
      }
    ],
    fields: [
      {
        key: "rabbitmq_user",
        label: "Broker user",
        kind: "string",
        description: "Initial RabbitMQ management and broker user.",
        required: true,
        defaultValue: "app"
      },
      {
        key: "rabbitmq_password",
        label: "Broker password",
        kind: "secret",
        description: "Password for the initial RabbitMQ user.",
        required: true,
        exampleValue: "replace-with-a-strong-password"
      },
      {
        key: "rabbitmq_amqp_port",
        label: "AMQP port",
        kind: "port",
        description: "Host port for AMQP clients.",
        required: true,
        defaultValue: "5672"
      },
      {
        key: "rabbitmq_management_port",
        label: "Management port",
        kind: "port",
        description: "Host port for the RabbitMQ management UI.",
        required: true,
        defaultValue: "15672"
      }
    ],
    volumes: [
      {
        nameTemplate: "{{STACK_NAME}}-rabbitmq-data",
        mountPath: "/var/lib/rabbitmq",
        summary: "Durable queue data and broker state."
      }
    ],
    healthChecks: [
      {
        serviceName: "rabbitmq",
        summary: "Uses `rabbitmq-diagnostics -q ping` inside the broker container.",
        readinessHint: "Expose both AMQP and management ports when operators need remote access."
      }
    ],
    composeTemplate: `name: {{STACK_NAME}}
services:
  rabbitmq:
    image: rabbitmq:3-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: "{{RABBITMQ_USER}}"
      RABBITMQ_DEFAULT_PASS: "{{RABBITMQ_PASSWORD}}"
    ports:
      - "{{RABBITMQ_AMQP_PORT}}:5672"
      - "{{RABBITMQ_MANAGEMENT_PORT}}:15672"
    volumes:
      - "{{STACK_NAME}}-rabbitmq-data:/var/lib/rabbitmq"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 15s
      timeout: 10s
      retries: 5
volumes:
  {{STACK_NAME}}-rabbitmq-data:
`
  },
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

function templateFieldToken(key: string): string {
  return key
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function sanitizeProjectName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");

  return cleaned.slice(0, 63) || fallback;
}

function requireTemplate(slug: string): AppTemplateDefinition {
  const template = APP_TEMPLATE_DEFINITIONS.find((candidate) => candidate.slug === slug);
  if (!template) {
    throw new Error(`Unknown app template "${slug}".`);
  }

  return template;
}

function renderTemplateString(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token: string) => {
    const replacement = replacements[token];
    if (replacement === undefined) {
      throw new Error(`Template token ${token} is not defined.`);
    }

    // Escape Compose/YAML-sensitive characters before injecting values into
    // double-quoted strings so operators can safely use $, " and \ in secrets.
    return replacement.replace(/\\/g, "\\\\").replace(/\$/g, "$$$$").replace(/"/g, '\\"');
  });
}

function validateFieldValue(field: AppTemplateFieldDefinition, value: string): void {
  if (!value && !field.required) {
    return;
  }

  if (value.length > 255) {
    throw new Error(`Template field "${field.label}" exceeds the 255 character limit.`);
  }

  if (
    [...value].some((char) => {
      const code = char.charCodeAt(0);
      return code === 0 || code === 10 || code === 13;
    })
  ) {
    throw new Error(`Template field "${field.label}" contains unsupported control characters.`);
  }

  if (field.kind === "port") {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`Template field "${field.label}" must be a valid TCP port.`);
    }
  }

  if (field.kind === "domain") {
    if (
      value.includes("://") ||
      !/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(value) ||
      value.startsWith(".") ||
      value.endsWith(".")
    ) {
      throw new Error(`Template field "${field.label}" must be a bare host or host:port.`);
    }
  }
}

export function listAppTemplates(): AppTemplateDefinition[] {
  return [...APP_TEMPLATE_DEFINITIONS];
}

export function getAppTemplate(slug: string): AppTemplateDefinition | undefined {
  return APP_TEMPLATE_DEFINITIONS.find((template) => template.slug === slug);
}

export function maskTemplateFieldValue(value: string, isSecret: boolean): string {
  if (!isSecret) {
    return value;
  }

  return value.length > 0 ? "••••••••" : "";
}

export function renderAppTemplate(input: {
  slug: string;
  projectName?: string;
  values?: Record<string, string | undefined>;
}): RenderedAppTemplate {
  const template = requireTemplate(input.slug);
  const stackName = sanitizeProjectName(
    input.projectName ?? template.defaultProjectName,
    template.slug
  );
  const allowedKeys = new Set(template.fields.map((field) => field.key));

  for (const key of Object.keys(input.values ?? {})) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Template field "${key}" is not defined for ${template.slug}.`);
    }
  }

  const fields = template.fields.map((field) => {
    const rawValue = input.values?.[field.key] ?? field.defaultValue ?? "";
    const value = rawValue.trim();

    if (field.required && value.length === 0) {
      throw new Error(`Template field "${field.label}" is required.`);
    }

    validateFieldValue(field, value);

    return {
      ...field,
      value
    };
  });

  const replacements: Record<string, string> = {
    STACK_NAME: stackName
  };

  for (const field of fields) {
    replacements[templateFieldToken(field.key)] = field.value;
  }

  return {
    template,
    projectName: stackName,
    stackName,
    fields,
    compose: renderTemplateString(template.composeTemplate, replacements)
  };
}
