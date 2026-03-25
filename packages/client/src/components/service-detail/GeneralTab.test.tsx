// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GeneralTab from "./GeneralTab";

const service = {
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

    fireEvent.click(screen.getByTestId("general-tab-open-deploy"));
    fireEvent.click(screen.getByTestId("general-tab-open-deployments"));
    fireEvent.click(screen.getByTestId("general-tab-open-logs"));

    expect(onOpenDeploy).toHaveBeenCalledTimes(1);
    expect(onOpenDeployments).toHaveBeenCalledTimes(1);
    expect(onOpenLogs).toHaveBeenCalledTimes(1);
  });
});
