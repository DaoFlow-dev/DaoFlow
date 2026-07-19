import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy
} from "@temporalio/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const temporal = vi.hoisted(() => {
  const workflowStart = vi.fn();
  const workflowDescribe = vi.fn();
  const workflowGetHandle = vi.fn(() => ({
    workflowId: "control-plane-recovery-recovery_217",
    describe: workflowDescribe
  }));
  const close = vi.fn();
  const connection = { close };
  const connect = vi.fn();

  return {
    close,
    connect,
    connection,
    workflowDescribe,
    workflowGetHandle,
    workflowStart
  };
});

vi.mock("@temporalio/client", () => ({
  Connection: { connect: temporal.connect },
  Client: function TemporalClient() {
    return {
      connection: temporal.connection,
      workflow: {
        start: temporal.workflowStart,
        getHandle: temporal.workflowGetHandle
      }
    };
  }
}));

import {
  closeTemporalClient,
  startControlPlaneRecoveryWorkflow,
  startDeploymentWorkflow,
  startRestoreWorkflow
} from "./client";

describe("control-plane recovery Temporal dispatch", () => {
  beforeEach(async () => {
    await closeTemporalClient();
    temporal.close.mockReset();
    temporal.connect.mockReset();
    temporal.workflowDescribe.mockReset();
    temporal.workflowGetHandle.mockClear();
    temporal.workflowStart.mockReset();
    temporal.connect.mockResolvedValue(temporal.connection);
    temporal.workflowStart.mockResolvedValue({
      workflowId: "control-plane-recovery-recovery_217",
      firstExecutionRunId: "new-run"
    });
  });

  afterEach(async () => {
    await closeTemporalClient();
  });

  it("uses one deterministic workflow ID and attaches to an existing execution", async () => {
    await expect(startControlPlaneRecoveryWorkflow({ bundleId: "recovery_217" })).resolves.toEqual({
      workflowId: "control-plane-recovery-recovery_217",
      runId: "new-run"
    });

    expect(temporal.workflowStart).toHaveBeenCalledWith(
      "controlPlaneRecoveryWorkflow",
      expect.objectContaining({
        workflowId: "control-plane-recovery-recovery_217",
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE
      })
    );

    temporal.workflowStart.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        "Workflow execution already started",
        "control-plane-recovery-recovery_217",
        "controlPlaneRecoveryWorkflow"
      )
    );
    temporal.workflowDescribe.mockResolvedValue({ runId: "existing-run" });

    await expect(startControlPlaneRecoveryWorkflow({ bundleId: "recovery_217" })).resolves.toEqual({
      workflowId: "control-plane-recovery-recovery_217",
      runId: "existing-run"
    });
    expect(temporal.workflowGetHandle).toHaveBeenCalledWith("control-plane-recovery-recovery_217");
  });

  it("uses existing workflow IDs when approved deployment and restore dispatches replay", async () => {
    await startDeploymentWorkflow({
      id: "op_deploy_240",
      serviceName: "api",
      sourceType: "compose",
      imageTag: "example/api:stable",
      commitSha: "abcdef1",
      configSnapshot: {}
    });
    await startRestoreWorkflow({
      restoreId: "op_restore_240",
      backupRunId: "brun_240",
      triggeredBy: "user_foundation_operator"
    });

    expect(temporal.workflowStart).toHaveBeenCalledWith(
      "deploymentWorkflow",
      expect.objectContaining({
        workflowId: "deployment-op_deploy_240",
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE
      })
    );
    expect(temporal.workflowStart).toHaveBeenCalledWith(
      "restoreWorkflow",
      expect.objectContaining({
        workflowId: "backup-restore-op_restore_240",
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE
      })
    );
  });
});
