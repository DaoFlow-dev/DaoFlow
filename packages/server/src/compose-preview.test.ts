import { describe, expect, it } from "vitest";
import {
  buildComposePreviewEnvEntries,
  deriveComposePreviewMetadata,
  readComposePreviewConfigFromConfig,
  writeComposePreviewConfigToConfig
} from "./compose-preview";

describe("compose preview", () => {
  it("normalizes preview config in service config records", () => {
    const config = writeComposePreviewConfigToConfig({
      config: {},
      preview: {
        enabled: true,
        mode: "pull-request",
        domainTemplate: "{service}-{pr}.preview.example.com",
        staleAfterHours: 72
      }
    });

    expect(readComposePreviewConfigFromConfig(config)).toEqual({
      enabled: true,
      mode: "pull-request",
      domainTemplate: "{service}-{pr}.preview.example.com",
      staleAfterHours: 72
    });
  });

  it("derives deterministic stack and env metadata for pull-request previews", () => {
    const metadata = deriveComposePreviewMetadata({
      config: {
        enabled: true,
        mode: "any",
        domainTemplate: "{service}-pr-{pr}.preview.example.com",
        staleAfterHours: null
      },
      request: {
        target: "pull-request",
        branch: "feature/login-flow",
        pullRequestNumber: 42,
        action: "deploy"
      },
      projectName: "Acme Platform",
      environmentName: "production",
      serviceName: "web",
      baseStackName: "Acme Platform"
    });

    expect(metadata).toMatchObject({
      target: "pull-request",
      key: "pr-42",
      branch: "feature/login-flow",
      envBranch: "preview/pr-42",
      stackName: "acme-platform-pr-42",
      primaryDomain: "web-pr-42.preview.example.com"
    });
    expect(buildComposePreviewEnvEntries(metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "DAOFLOW_PREVIEW", value: "true" }),
        expect.objectContaining({ key: "DAOFLOW_PREVIEW_PR_NUMBER", value: "42" }),
        expect.objectContaining({
          key: "DAOFLOW_PREVIEW_DOMAIN",
          value: "web-pr-42.preview.example.com"
        })
      ])
    );
  });
});
