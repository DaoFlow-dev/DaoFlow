// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ControlPlaneRecoveryPage from "./ControlPlaneRecoveryPage";

const {
  backupDestinationsUseQueryMock,
  planUseQueryMock,
  bundlesUseQueryMock,
  bundleUseQueryMock,
  metadataUseQueryMock,
  runUseMutationMock,
  mutateAsyncMock,
  refetchPlanMock,
  refetchBundlesMock
} = vi.hoisted(() => ({
  backupDestinationsUseQueryMock: vi.fn(),
  planUseQueryMock: vi.fn(),
  bundlesUseQueryMock: vi.fn(),
  bundleUseQueryMock: vi.fn(),
  metadataUseQueryMock: vi.fn(),
  runUseMutationMock: vi.fn(),
  mutateAsyncMock: vi.fn(),
  refetchPlanMock: vi.fn().mockResolvedValue(undefined),
  refetchBundlesMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "owner_1" } } })
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    backupDestinations: { useQuery: backupDestinationsUseQueryMock },
    controlPlaneRecoveryPlan: { useQuery: planUseQueryMock },
    controlPlaneRecoveryBundles: { useQuery: bundlesUseQueryMock },
    controlPlaneRecoveryBundle: { useQuery: bundleUseQueryMock },
    controlPlaneRecoveryBundleMetadata: { useQuery: metadataUseQueryMock },
    triggerControlPlaneRecoveryBundle: { useMutation: runUseMutationMock }
  }
}));

describe("ControlPlaneRecoveryPage", () => {
  beforeEach(() => {
    backupDestinationsUseQueryMock.mockReturnValue({
      data: [{ id: "dest_primary", name: "Primary backups", provider: "s3" }],
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    });
    planUseQueryMock.mockReturnValue({
      data: {
        isReady: true,
        destination: { id: "dest_primary", name: "Primary backups" },
        keyFingerprint: "sha256:recovery",
        checks: [{ status: "passed", detail: "Destination is reachable." }],
        requiredExternalSecrets: ["BETTER_AUTH_SECRET"]
      },
      isLoading: false,
      isError: false,
      refetch: refetchPlanMock
    });
    bundlesUseQueryMock.mockReturnValue({
      data: {
        bundles: [
          {
            id: "rb_1",
            status: "verified",
            keyFingerprint: "sha256:recovery",
            createdAt: "2026-07-18T12:00:00.000Z"
          }
        ]
      },
      isLoading: false,
      isError: false,
      refetch: refetchBundlesMock
    });
    bundleUseQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    });
    metadataUseQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    });
    runUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: mutateAsyncMock.mockResolvedValue({ id: "rb_2", status: "queued" })
    });
  });

  afterEach(() => cleanup());

  it("shows readiness, safe key metadata, recent bundles, and an explicit run confirmation", async () => {
    render(
      <MemoryRouter initialEntries={["/backups/recovery"]}>
        <ControlPlaneRecoveryPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("recovery-page-title")).toHaveTextContent("Control-plane recovery");
    expect(screen.getByTestId("recovery-readiness-status")).toHaveTextContent("ready");
    expect(screen.getByTestId("recovery-key-fingerprint")).toHaveTextContent("sha256:recovery");
    expect(screen.getByTestId("recovery-required-secrets")).toHaveTextContent("BETTER_AUTH_SECRET");
    expect(screen.getByTestId("recovery-bundle-rb_1")).toHaveTextContent("verified");

    fireEvent.click(screen.getByTestId("recovery-run-open-confirmation"));
    expect(screen.getByTestId("recovery-run-confirm")).toBeVisible();
    fireEvent.click(screen.getByTestId("recovery-run-confirm"));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        destinationId: "dest_primary"
      });
    });
    expect(screen.getByTestId("recovery-feedback")).toHaveTextContent("rb_2");
  });

  it("loads inspection and metadata for a selected recent bundle", async () => {
    bundleUseQueryMock.mockImplementation((input: { bundleId: string }) => ({
      data:
        input.bundleId === "rb_1"
          ? {
              id: "rb_1",
              status: "verified",
              appVersion: "0.9.2",
              schemaVersion: "20260718",
              keyFingerprint: "sha256:recovery",
              objectPaths: { bundle: "backups/rb_1.bundle", manifest: "backups/rb_1.json" },
              verification: {
                success: true,
                checks: { restore: { status: "passed", detail: "Isolated restore passed." } }
              }
            }
          : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    }));
    metadataUseQueryMock.mockImplementation((input: { bundleId: string }) => ({
      data:
        input.bundleId === "rb_1"
          ? { bundleId: "rb_1", keyFingerprint: "sha256:recovery", manifest: { formatVersion: 1 } }
          : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    }));

    render(
      <MemoryRouter initialEntries={["/backups/recovery"]}>
        <ControlPlaneRecoveryPage />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId("recovery-bundle-inspect-rb_1"));

    await waitFor(() => {
      expect(screen.getByTestId("recovery-selected-bundle")).toBeInTheDocument();
      expect(screen.getByTestId("recovery-object-path-bundle")).toHaveTextContent("rb_1.bundle");
      expect(screen.getByText("Downloadable recovery metadata")).toBeVisible();
    });
    expect(bundleUseQueryMock).toHaveBeenLastCalledWith({ bundleId: "rb_1" }, { enabled: true });
    expect(metadataUseQueryMock).toHaveBeenLastCalledWith({ bundleId: "rb_1" }, { enabled: true });
  });
});
