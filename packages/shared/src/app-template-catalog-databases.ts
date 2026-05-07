import type { AppTemplateDefinition } from "./app-template-types";

export const databaseAppTemplates = [
  {
    slug: "mysql",
    name: "MySQL",
    category: "database",
    summary: "Single-node MySQL with persistent storage and explicit app credentials.",
    description:
      "Use this for applications that expect MySQL-compatible storage with a named data volume and operator-managed credentials.",
    tags: ["mysql", "database", "stateful"],
    defaultProjectName: "mysql",
    maintenance: {
      version: "8.4",
      sourceName: "Docker Hub mysql",
      sourceUrl: "https://hub.docker.com/_/mysql",
      reviewedAt: "2026-03-20T00:00:00.000Z",
      reviewCadenceDays: 90,
      changeNotes: [
        "Pinned the starter to mysql:8.4 for the current LTS track.",
        "Uses MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_ROOT_PASSWORD for first-boot initialization."
      ]
    },
    services: [
      {
        name: "mysql",
        role: "database",
        summary: "Primary MySQL instance exposed on a configurable host port."
      }
    ],
    fields: [
      {
        key: "mysql_database",
        label: "Database name",
        kind: "string",
        description: "Initial database created on first boot.",
        required: true,
        defaultValue: "app"
      },
      {
        key: "mysql_user",
        label: "Database user",
        kind: "string",
        description: "Application user granted access to the initial database.",
        required: true,
        defaultValue: "app"
      },
      {
        key: "mysql_password",
        label: "Database password",
        kind: "secret",
        description: "Password for the application database user.",
        required: true,
        exampleValue: "replace-with-a-strong-password"
      },
      {
        key: "mysql_root_password",
        label: "Root password",
        kind: "secret",
        description: "Password for the MySQL root account.",
        required: true,
        exampleValue: "replace-with-a-strong-root-password"
      },
      {
        key: "mysql_port",
        label: "Published port",
        kind: "port",
        description: "Host port that forwards to MySQL inside the stack.",
        required: true,
        defaultValue: "3306"
      }
    ],
    volumes: [
      {
        nameTemplate: "{{STACK_NAME}}-mysql-data",
        mountPath: "/var/lib/mysql",
        summary: "Database state and redo logs."
      }
    ],
    healthChecks: [
      {
        serviceName: "mysql",
        summary: "Runs `mysqladmin ping` with the configured application credentials.",
        readinessHint: "Wait for the container health check before attaching dependent workloads."
      }
    ],
    composeTemplate: `name: {{STACK_NAME}}
services:
  mysql:
    image: mysql:8.4
    restart: unless-stopped
    ports:
      - "{{MYSQL_PORT}}:3306"
    environment:
      MYSQL_DATABASE: "{{MYSQL_DATABASE}}"
      MYSQL_USER: "{{MYSQL_USER}}"
      MYSQL_PASSWORD: "{{MYSQL_PASSWORD}}"
      MYSQL_ROOT_PASSWORD: "{{MYSQL_ROOT_PASSWORD}}"
    volumes:
      - "{{STACK_NAME}}-mysql-data:/var/lib/mysql"
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u \\"$$MYSQL_USER\\" --password=\\"$$MYSQL_PASSWORD\\" --silent"]
      interval: 10s
      timeout: 5s
      retries: 10
volumes:
  {{STACK_NAME}}-mysql-data:
`
  },
  {
    slug: "mariadb",
    name: "MariaDB",
    category: "database",
    summary: "Single-node MariaDB with persistent storage and explicit app credentials.",
    description:
      "Use this for applications that need a MySQL-compatible MariaDB service with named storage and controlled credentials.",
    tags: ["mariadb", "mysql", "database", "stateful"],
    defaultProjectName: "mariadb",
    maintenance: {
      version: "11.4",
      sourceName: "Docker Hub mariadb",
      sourceUrl: "https://hub.docker.com/_/mariadb",
      reviewedAt: "2026-03-20T00:00:00.000Z",
      reviewCadenceDays: 90,
      changeNotes: [
        "Pinned the starter to mariadb:11.4 for the current long-term release line.",
        "Uses MARIADB_DATABASE, MARIADB_USER, MARIADB_PASSWORD, and MARIADB_ROOT_PASSWORD for first-boot initialization."
      ]
    },
    services: [
      {
        name: "mariadb",
        role: "database",
        summary: "Primary MariaDB instance exposed on a configurable host port."
      }
    ],
    fields: [
      {
        key: "mariadb_database",
        label: "Database name",
        kind: "string",
        description: "Initial database created on first boot.",
        required: true,
        defaultValue: "app"
      },
      {
        key: "mariadb_user",
        label: "Database user",
        kind: "string",
        description: "Application user granted access to the initial database.",
        required: true,
        defaultValue: "app"
      },
      {
        key: "mariadb_password",
        label: "Database password",
        kind: "secret",
        description: "Password for the application database user.",
        required: true,
        exampleValue: "replace-with-a-strong-password"
      },
      {
        key: "mariadb_root_password",
        label: "Root password",
        kind: "secret",
        description: "Password for the MariaDB root account.",
        required: true,
        exampleValue: "replace-with-a-strong-root-password"
      },
      {
        key: "mariadb_port",
        label: "Published port",
        kind: "port",
        description: "Host port that forwards to MariaDB inside the stack.",
        required: true,
        defaultValue: "3306"
      }
    ],
    volumes: [
      {
        nameTemplate: "{{STACK_NAME}}-mariadb-data",
        mountPath: "/var/lib/mysql",
        summary: "Database state and redo logs."
      }
    ],
    healthChecks: [
      {
        serviceName: "mariadb",
        summary: "Runs `mariadb-admin ping` with the configured application credentials.",
        readinessHint: "Wait for the container health check before attaching dependent workloads."
      }
    ],
    composeTemplate: `name: {{STACK_NAME}}
services:
  mariadb:
    image: mariadb:11.4
    restart: unless-stopped
    ports:
      - "{{MARIADB_PORT}}:3306"
    environment:
      MARIADB_DATABASE: "{{MARIADB_DATABASE}}"
      MARIADB_USER: "{{MARIADB_USER}}"
      MARIADB_PASSWORD: "{{MARIADB_PASSWORD}}"
      MARIADB_ROOT_PASSWORD: "{{MARIADB_ROOT_PASSWORD}}"
    volumes:
      - "{{STACK_NAME}}-mariadb-data:/var/lib/mysql"
    healthcheck:
      test: ["CMD-SHELL", "mariadb-admin ping -h 127.0.0.1 -u \\"$$MARIADB_USER\\" --password=\\"$$MARIADB_PASSWORD\\" --silent"]
      interval: 10s
      timeout: 5s
      retries: 10
volumes:
  {{STACK_NAME}}-mariadb-data:
`
  }
] as const satisfies readonly AppTemplateDefinition[];
