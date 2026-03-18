import { describe, expect, it } from "vitest";
import {
  DeploymentConclusion,
  DeploymentHealthStatus,
  DeploymentLifecycleStatus,
  canCancelDeployment,
  canRollbackDeployment,
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";

describe("deployment status helpers", () => {
  it("normalizes completed succeeded deployments to healthy", () => {
    expect(
      normalizeDeploymentStatus(DeploymentLifecycleStatus.Completed, DeploymentConclusion.Succeeded)
    ).toBe(DeploymentHealthStatus.Healthy);
  });

  it("normalizes active lifecycle stages to running", () => {
    expect(normalizeDeploymentStatus(DeploymentLifecycleStatus.Prepare, null)).toBe(
      DeploymentHealthStatus.Running
    );
    expect(normalizeDeploymentStatus(DeploymentLifecycleStatus.Deploy, null)).toBe(
      DeploymentHealthStatus.Running
    );
    expect(normalizeDeploymentStatus(DeploymentLifecycleStatus.Finalize, null)).toBe(
      DeploymentHealthStatus.Running
    );
  });

  it("treats cancelled conclusions as failed for tone and health", () => {
    expect(
      normalizeDeploymentStatus(DeploymentLifecycleStatus.Failed, DeploymentConclusion.Cancelled)
    ).toBe(DeploymentHealthStatus.Failed);
    expect(
      getDeploymentStatusTone(DeploymentLifecycleStatus.Failed, DeploymentConclusion.Cancelled)
    ).toBe("failed");
    expect(
      formatDeploymentStatusLabel(DeploymentLifecycleStatus.Failed, DeploymentConclusion.Cancelled)
    ).toBe("Cancelled");
  });

  it("provides operator-friendly deployment labels", () => {
    expect(formatDeploymentStatusLabel(DeploymentLifecycleStatus.Queued, null)).toBe("Queued");
    expect(formatDeploymentStatusLabel(DeploymentLifecycleStatus.Prepare, null)).toBe("Preparing");
    expect(formatDeploymentStatusLabel(DeploymentLifecycleStatus.Deploy, null)).toBe("Deploying");
    expect(
      formatDeploymentStatusLabel(
        DeploymentLifecycleStatus.Completed,
        DeploymentConclusion.Succeeded
      )
    ).toBe("Healthy");
  });

  it("only allows cancellation for queued and running deployments", () => {
    expect(canCancelDeployment(DeploymentLifecycleStatus.Queued, null)).toBe(true);
    expect(canCancelDeployment(DeploymentLifecycleStatus.Deploy, null)).toBe(true);
    expect(
      canCancelDeployment(DeploymentLifecycleStatus.Completed, DeploymentConclusion.Succeeded)
    ).toBe(false);
  });

  it("only allows rollback for successful completed deployments with a service target", () => {
    expect(
      canRollbackDeployment(
        DeploymentLifecycleStatus.Completed,
        DeploymentConclusion.Succeeded,
        true
      )
    ).toBe(true);
    expect(
      canRollbackDeployment(
        DeploymentLifecycleStatus.Completed,
        DeploymentConclusion.Succeeded,
        false
      )
    ).toBe(false);
    expect(
      canRollbackDeployment(DeploymentLifecycleStatus.Deploy, DeploymentConclusion.Succeeded, true)
    ).toBe(false);
  });
});
