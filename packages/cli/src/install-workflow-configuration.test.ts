import { describe, expect, test } from "bun:test";
import { CommandActionError, type CommandActionContext } from "./command-action";
import { resolveRequestedInstallWorkflowProfile } from "./install-workflow-configuration";

describe("install workflow profile configuration", () => {
  test("rejects unknown workflow profiles with a stable error code", () => {
    const ctx = {
      fail(message: string, options?: { code?: string }): never {
        throw new CommandActionError(message, options);
      }
    } as CommandActionContext;

    try {
      resolveRequestedInstallWorkflowProfile({ value: "durable-ish", ctx });
      throw new Error("Expected invalid workflow profile to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(CommandActionError);
      expect((error as CommandActionError).code).toBe("INVALID_WORKFLOW_PROFILE");
      expect((error as Error).message).toContain("lean, temporal");
    }
  });
});
