import type { AppTemplateDefinition } from "./app-template-types";

export const infrastructureAppTemplates = [
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
  }
] as const satisfies readonly AppTemplateDefinition[];
