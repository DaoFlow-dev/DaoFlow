import { describe, expect, it } from "vitest";
import {
  normalizeComposeFilePaths,
  normalizeComposeProfiles,
  readComposeSourceSelection,
  writeComposeSourceSelectionToConfig
} from "./compose-source";

describe("compose source selection", () => {
  it("normalizes ordered compose files and preserves the first file", () => {
    expect(
      normalizeComposeFilePaths({
        composeFiles: ["./compose.yaml", "deploy/compose.prod.yaml", "./compose.yaml"]
      })
    ).toEqual(["compose.yaml", "deploy/compose.prod.yaml"]);
  });

  it("deduplicates and preserves profile order", () => {
    expect(normalizeComposeProfiles(["web", "worker", "web", "  ", null])).toEqual([
      "web",
      "worker"
    ]);
  });

  it("prefers snapshot and environment compose source metadata over project defaults", () => {
    expect(
      readComposeSourceSelection({
        composePath: "docker-compose.yml",
        projectConfig: {
          composeFilePaths: ["compose.base.yaml", "compose.prod.yaml"],
          composeProfiles: ["project-default"]
        },
        environmentConfig: {
          composeFilePaths: ["compose.base.yaml", "compose.staging.yaml"],
          composeProfiles: ["staging"]
        },
        snapshot: {
          composeFilePaths: ["compose.base.yaml", "compose.release.yaml"],
          composeProfiles: ["release"]
        }
      })
    ).toEqual({
      composeFiles: ["compose.base.yaml", "compose.release.yaml"],
      composeProfiles: ["release"]
    });
  });

  it("lets a higher-precedence composeFilePath override lower-precedence composeFilePaths", () => {
    expect(
      readComposeSourceSelection({
        composePath: "docker-compose.yml",
        projectConfig: {
          composeFilePaths: ["compose.base.yaml", "compose.prod.yaml"]
        },
        environmentConfig: {
          composeFilePath: "ops/release.yaml"
        }
      })
    ).toEqual({
      composeFiles: ["ops/release.yaml"],
      composeProfiles: []
    });
  });

  it("writes normalized compose source metadata into config records", () => {
    expect(
      writeComposeSourceSelectionToConfig({
        config: { targetServerId: "srv_123" },
        composeFiles: ["./compose.yaml", "compose.prod.yaml"],
        composeProfiles: ["prod", "workers"]
      })
    ).toEqual({
      targetServerId: "srv_123",
      composeFilePath: "compose.yaml",
      composeFilePaths: ["compose.yaml", "compose.prod.yaml"],
      composeProfiles: ["prod", "workers"]
    });
  });
});
