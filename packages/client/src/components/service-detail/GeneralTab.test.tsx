// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GeneralTab from "./GeneralTab";

const service: Parameters<typeof GeneralTab>[0]["service"] = {
  id: "svc_api",
  name: "api",
  slug: "api",
  sourceType: "compose",
  status: "healthy",
  statusTone: "healthy",
  statusLabel: "Healthy",
  imageReference: "ghcr.io/example/api:latest",
  dockerfilePath: null,
  composeServiceName: "api",
  port: "3000",
  healthcheckPath: "/health",
  replicaCount: "1",
  targetServerId: "srv_1",
  createdAt: "2026-03-20T00:00:00.000Z",
  updatedAt: "2026-03-20T01:00:00.000Z",
  runtimeSummary: {
    statusLabel: "Healthy",
    statusTone: "healthy",
    summary: "Serving traffic normally.",
    observedAt: "2026-03-20T01:00:00.000Z"
  },
  endpointSummary: {
    status: "healthy",
    statusLabel: "Healthy",
    statusTone: "healthy",
    summary: "app.example.com is live through edge-prod.",
    primaryLabel: "Primary domain",
    primaryHref: "https://app.example.com",
    links: [
      {
        id: "domain_primary",
        kind: "domain",
        label: "Primary domain",
        href: "https://app.example.com",
        copyValue: "https://app.example.com",
        status: "healthy",
        statusLabel: "Healthy",
        statusTone: "healthy",
        summary: "app.example.com is live through edge-prod.",
        isCanonical: true,
        isPublic: true
      }
    ]
  },
  latestDeployment: {
    targetServerName: "foundation",
    imageTag: "ghcr.io/example/api:sha-123",
    finishedAt: "2026-03-20T01:00:00.000Z"
  }
};

describe("GeneralTab", () => {
  afterEach(() => {
    cleanup();
  });

  it("routes deployment actions through the shared deploy entrypoints", () => {
    const onOpenDeploy = vi.fn();
    const onOpenDeployments = vi.fn();
    const onOpenLogs = vi.fn();

    render(
      <GeneralTab
        service={service}
        onOpenDeploy={onOpenDeploy}
        onOpenDeployments={onOpenDeployments}
        onOpenLogs={onOpenLogs}
      />
    );

    expect(screen.getByTestId("general-tab-deploy-guidance")).toHaveTextContent("deploy center");
    expect(screen.getByTestId("service-links-card-svc_api")).toBeVisible();

    fireEvent.click(screen.getByTestId("general-tab-open-deploy"));
    fireEvent.click(screen.getByTestId("general-tab-open-deployments"));
    fireEvent.click(screen.getByTestId("general-tab-open-logs"));

    expect(onOpenDeploy).toHaveBeenCalledTimes(1);
    expect(onOpenDeployments).toHaveBeenCalledTimes(1);
    expect(onOpenLogs).toHaveBeenCalledTimes(1);
  });

  it("renders managed database metadata with masked connection strings", () => {
    render(
      <GeneralTab
        service={{
          ...service,
          managedDatabase: {
            kind: "postgres",
            label: "PostgreSQL",
            databaseName: "app",
            username: "app",
            port: "5432",
            internalPort: "5432",
            serviceName: "postgres",
            volumeName: "app-postgres-data",
            backupPolicyId: "pol_123",
            backupType: "database",
            backupEngine: "postgres",
            connectionUriMasked: "postgresql://app:[secret]@localhost:5432/app",
            internalConnectionUriMasked: "postgresql://app:[secret]@postgres:5432/app"
          }
        }}
        onOpenDeploy={vi.fn()}
        onOpenDeployments={vi.fn()}
        onOpenLogs={vi.fn()}
      />
    );

    expect(screen.getByTestId("managed-database-card-svc_api")).toBeVisible();
    expect(screen.getByTestId("managed-database-public-uri-svc_api")).toHaveTextContent(
      "postgresql://app:[secret]@localhost:5432/app"
    );
    expect(screen.getByTestId("managed-database-backup-svc_api")).toHaveTextContent(
      "postgres dumps enabled"
    );
    expect(screen.queryByText("app-password")).not.toBeInTheDocument();
  });
});
