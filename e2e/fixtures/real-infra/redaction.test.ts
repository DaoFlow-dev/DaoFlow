import { describe, expect, test } from "bun:test";
import { redactArtifactValue } from "./redaction";

describe("real infrastructure artifact redaction", () => {
  test("redacts configured sensitive values and sensitive field names", () => {
    const result = redactArtifactValue(
      {
        message: "failed at target-value with secret-value",
        sshHost: "target-value",
        evidenceId: "event:42"
      },
      ["target-value", "secret-value"]
    );

    expect(result).toEqual({
      message: "failed at [redacted] with [redacted]",
      sshHost: "[redacted]",
      evidenceId: "event:42"
    });
  });
});
