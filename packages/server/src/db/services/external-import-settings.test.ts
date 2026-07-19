import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTERNAL_IMPORT_MAX_BYTES,
  normalizeExternalImportSettings
} from "./external-import-settings";

const enabledS3 = {
  externalImportEnabled: true,
  externalImportPrefix: "approved/postgres",
  maxExternalImportBytes: String(DEFAULT_EXTERNAL_IMPORT_MAX_BYTES),
  provider: "s3",
  encryptionMode: "none"
};

describe("external destination import settings", () => {
  it("defaults imports to disabled and normalizes an enabled prefix", () => {
    expect(normalizeExternalImportSettings({ provider: "s3", encryptionMode: "none" })).toEqual({
      externalImportEnabled: false,
      externalImportPrefix: null,
      maxExternalImportBytes: String(DEFAULT_EXTERNAL_IMPORT_MAX_BYTES)
    });
    expect(normalizeExternalImportSettings(enabledS3)).toMatchObject({
      externalImportEnabled: true,
      externalImportPrefix: "approved/postgres/"
    });
  });

  it("rejects enabled imports for non-S3 or encrypted effective destinations", () => {
    expect(() => normalizeExternalImportSettings({ ...enabledS3, provider: "sftp" })).toThrow(
      "S3-compatible"
    );
    expect(() =>
      normalizeExternalImportSettings({ ...enabledS3, encryptionMode: "archive-zip" })
    ).toThrow("encryption mode none");
    expect(() =>
      normalizeExternalImportSettings(
        { externalImportEnabled: true },
        { ...enabledS3, externalImportPrefix: "approved/postgres/" }
      )
    ).not.toThrow();
    expect(() =>
      normalizeExternalImportSettings(
        { externalImportEnabled: true, encryptionMode: "rclone-crypt" },
        { ...enabledS3, externalImportPrefix: "approved/postgres/" }
      )
    ).toThrow("encryption mode none");
  });
});
