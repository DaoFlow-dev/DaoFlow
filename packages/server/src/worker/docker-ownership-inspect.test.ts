import { describe, expect, it } from "vitest";
import { DOCKER_OWNERSHIP_LABEL_KEYS } from "../docker-ownership";
import {
  buildDockerOwnershipLabelInspectFormat,
  parseDockerOwnershipLabelLine
} from "./docker-ownership-inspect";

describe("Docker ownership label inspection", () => {
  it("requests only the six ownership labels", () => {
    const format = buildDockerOwnershipLabelInspectFormat(".Labels");

    for (const key of DOCKER_OWNERSHIP_LABEL_KEYS) expect(format).toContain(`"${key}"`);
    expect(format).not.toContain("{{json .Labels}}");
  });

  it("parses ownership values without accepting malformed output", () => {
    const values = ["true", "team_1", "project_1", "environment_1", "service_1", "deployment_1"];
    const line = values.map((value) => JSON.stringify(value)).join("\t");

    expect(parseDockerOwnershipLabelLine(line)).toEqual(
      Object.fromEntries(DOCKER_OWNERSHIP_LABEL_KEYS.map((key, index) => [key, values[index]]))
    );
    expect(parseDockerOwnershipLabelLine('"true"\t"team_1"')).toBeNull();
    expect(parseDockerOwnershipLabelLine('"true"\tsecret\t"project_1"')).toBeNull();
  });
});
