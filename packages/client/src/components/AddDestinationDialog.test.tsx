// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddDestinationDialog } from "./AddDestinationDialog";

describe("AddDestinationDialog", () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeTextMock.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderDialog(onSubmit = vi.fn()) {
    render(
      <AddDestinationDialog
        open={true}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        isPending={false}
      />
    );

    return { onSubmit };
  }

  function selectProvider(name: string) {
    fireEvent.click(screen.getByTestId("destination-provider-select"));
    fireEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
  }

  it("submits the existing S3 payload contract", () => {
    const { onSubmit } = renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "archive-s3" } });
    fireEvent.click(screen.getByTestId("destination-s3-provider-select"));
    fireEvent.click(screen.getByRole("option", { name: /Cloudflare R2/ }));
    fireEvent.change(screen.getByLabelText("Access Key"), { target: { value: "access-key" } });
    fireEvent.change(screen.getByLabelText("Secret Key"), { target: { value: "secret-key" } });
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "dao-archive" } });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "auto" } });
    fireEvent.change(screen.getByLabelText("Endpoint"), {
      target: { value: "https://example.r2.cloudflarestorage.com" }
    });
    fireEvent.click(screen.getByTestId("destination-create-button"));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "archive-s3",
      provider: "s3",
      accessKey: "access-key",
      secretAccessKey: "secret-key",
      bucket: "dao-archive",
      region: "auto",
      endpoint: "https://example.r2.cloudflarestorage.com",
      s3Provider: "Cloudflare",
      localPath: undefined,
      rcloneConfig: undefined,
      rcloneRemotePath: undefined,
      oauthToken: undefined
    });
  });

  it("keeps a manually entered name when the provider changes", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "manual-destination" } });
    selectProvider("Local Filesystem");

    expect(screen.getByLabelText("Name")).toHaveValue("manual-destination");
  });

  it("uses the provider default name, copies the authorize command, and submits OAuth tokens", async () => {
    const { onSubmit } = renderDialog();

    selectProvider("Google Drive");

    expect(screen.getByLabelText("Name")).toHaveValue("gdrive-backup");
    fireEvent.click(screen.getByTestId("destination-authorize-copy-button"));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('rclone authorize "drive"');
    });

    fireEvent.change(screen.getByLabelText("OAuth Token"), {
      target: { value: '{"access_token":"token"}' }
    });
    fireEvent.click(screen.getByTestId("destination-create-button"));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "gdrive-backup",
      provider: "gdrive",
      accessKey: undefined,
      secretAccessKey: undefined,
      bucket: undefined,
      region: undefined,
      endpoint: undefined,
      s3Provider: undefined,
      localPath: undefined,
      rcloneConfig: undefined,
      rcloneRemotePath: undefined,
      oauthToken: '{"access_token":"token"}'
    });
  });

  it("submits the local filesystem payload contract", () => {
    const { onSubmit } = renderDialog();

    selectProvider("Local Filesystem");

    expect(screen.getByLabelText("Name")).toHaveValue("local-backup");
    fireEvent.change(screen.getByLabelText("Local Path"), {
      target: { value: "/srv/backups" }
    });
    fireEvent.click(screen.getByTestId("destination-create-button"));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "local-backup",
      provider: "local",
      accessKey: undefined,
      secretAccessKey: undefined,
      bucket: undefined,
      region: undefined,
      endpoint: undefined,
      s3Provider: undefined,
      localPath: "/srv/backups",
      rcloneConfig: undefined,
      rcloneRemotePath: undefined,
      oauthToken: undefined
    });
  });

  it.each([
    ["SFTP / SSH", "sftp", "sftp-backup"],
    ["Custom Rclone Config", "rclone", "rclone-remote"]
  ])("submits remote config payloads for %s providers", (providerLabel, provider, expectedName) => {
    const { onSubmit } = renderDialog();

    selectProvider(providerLabel);

    expect(screen.getByLabelText("Name")).toHaveValue(expectedName);
    fireEvent.change(screen.getByLabelText("Rclone Config (INI format)"), {
      target: { value: "[remote]\ntype = sftp\nhost = backup.example.com" }
    });
    fireEvent.change(screen.getByLabelText("Remote Path"), {
      target: { value: "backups/daoflow" }
    });
    fireEvent.click(screen.getByTestId("destination-create-button"));

    expect(onSubmit).toHaveBeenCalledWith({
      name: expectedName,
      provider,
      accessKey: undefined,
      secretAccessKey: undefined,
      bucket: undefined,
      region: undefined,
      endpoint: undefined,
      s3Provider: undefined,
      localPath: undefined,
      rcloneConfig: "[remote]\ntype = sftp\nhost = backup.example.com",
      rcloneRemotePath: "backups/daoflow",
      oauthToken: undefined
    });
  });
});
