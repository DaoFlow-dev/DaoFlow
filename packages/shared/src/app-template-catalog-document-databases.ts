import type { AppTemplateDefinition } from "./app-template-types";

export const documentDatabaseAppTemplates = [
  {
    slug: "mongo",
    name: "MongoDB",
    category: "database",
    summary: "Single-node MongoDB with authentication and persistent storage.",
    description:
      "Use this for document storage workloads that need an authenticated MongoDB instance and named data volume.",
    tags: ["mongo", "mongodb", "database", "stateful"],
    defaultProjectName: "mongo",
    maintenance: {
      version: "7",
      sourceName: "Docker Hub mongo",
      sourceUrl: "https://hub.docker.com/_/mongo",
      reviewedAt: "2026-03-20T00:00:00.000Z",
      reviewCadenceDays: 90,
      changeNotes: [
        "Pinned the starter to mongo:7 for the default single-node path.",
        "Uses MONGO_INITDB_ROOT_USERNAME and MONGO_INITDB_ROOT_PASSWORD so authentication is enabled on first boot."
      ]
    },
    services: [
      {
        name: "mongo",
        role: "database",
        summary: "Primary MongoDB instance exposed on a configurable host port."
      }
    ],
    fields: [
      {
        key: "mongo_database",
        label: "Database name",
        kind: "string",
        description: "Application database name used in generated connection guidance.",
        required: true,
        defaultValue: "app"
      },
      {
        key: "mongo_root_user",
        label: "Root user",
        kind: "string",
        description: "Root user created in the admin authentication database.",
        required: true,
        defaultValue: "root"
      },
      {
        key: "mongo_root_password",
        label: "Root password",
        kind: "secret",
        description: "Password for the MongoDB root user.",
        required: true,
        exampleValue: "replace-with-a-strong-password"
      },
      {
        key: "mongo_port",
        label: "Published port",
        kind: "port",
        description: "Host port that forwards to MongoDB inside the stack.",
        required: true,
        defaultValue: "27017"
      }
    ],
    volumes: [
      {
        nameTemplate: "{{STACK_NAME}}-mongo-data",
        mountPath: "/data/db",
        summary: "MongoDB data files and journal."
      }
    ],
    healthChecks: [
      {
        serviceName: "mongo",
        summary: "Runs `mongosh` and expects an admin ping response.",
        readinessHint: "Wait for the container health check before attaching dependent workloads."
      }
    ],
    composeTemplate: `name: {{STACK_NAME}}
services:
  mongo:
    image: mongo:7
    restart: unless-stopped
    ports:
      - "{{MONGO_PORT}}:27017"
    environment:
      MONGO_INITDB_DATABASE: "{{MONGO_DATABASE}}"
      MONGO_INITDB_ROOT_USERNAME: "{{MONGO_ROOT_USER}}"
      MONGO_INITDB_ROOT_PASSWORD: "{{MONGO_ROOT_PASSWORD}}"
    volumes:
      - "{{STACK_NAME}}-mongo-data:/data/db"
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --username \\"$$MONGO_INITDB_ROOT_USERNAME\\" --password \\"$$MONGO_INITDB_ROOT_PASSWORD\\" --authenticationDatabase admin --eval 'db.adminCommand({ ping: 1 }).ok' | grep 1"]
      interval: 10s
      timeout: 5s
      retries: 10
volumes:
  {{STACK_NAME}}-mongo-data:
`
  }
] as const satisfies readonly AppTemplateDefinition[];
