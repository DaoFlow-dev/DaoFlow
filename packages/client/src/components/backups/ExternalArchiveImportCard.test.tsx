// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalArchiveImportCard } from "./ExternalArchiveImportCard";

const { objectsUseQueryMock, registerUseMutationMock } = vi.hoisted(() => ({
  objectsUseQueryMock: vi.fn(),
  registerUseMutationMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    externalBackupObjects: { useQuery: objectsUseQueryMock },
    registerExternalBackupArtifact: { useMutation: registerUseMutationMock }
  }
}));

describe("ExternalArchiveImportCard", () => {
  beforeEach(() => {
    objectsUseQueryMock.mockReturnValue({ data: { objects: [] } });
    registerUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  });

  afterEach(cleanup);

  it("keeps external imports disabled until the destination has an approved boundary", () => {
    render(
      <MemoryRouter>
        <ExternalArchiveImportCard
          destinationId="dest_1"
          enabled={false}
          approvedPrefix={null}
          maxBytes={2_147_483_648}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/imports are disabled for this destination/i)).toBeVisible();
    expect(objectsUseQueryMock).toHaveBeenCalledWith(
      { destinationId: "dest_1" },
      { enabled: false }
    );
  });

  it("registers an exact key with the declared PostgreSQL major", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      artifact: { id: "xba_1" },
      workflowId: "external-import-xba_1",
      nextAction: "test-restore"
    });
    registerUseMutationMock.mockReturnValue({ isPending: false, mutateAsync });

    render(
      <MemoryRouter>
        <ExternalArchiveImportCard
          destinationId="dest_1"
          enabled={true}
          approvedPrefix="database-imports/"
          maxBytes={2_147_483_648}
        />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByTestId("external-archive-key"), {
      target: { value: "database-imports/customer.dump" }
    });
    fireEvent.change(screen.getByTestId("external-archive-postgres-major"), {
      target: { value: "16" }
    });
    fireEvent.click(screen.getByTestId("external-archive-register"));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        destinationId: "dest_1",
        objectKey: "database-imports/customer.dump",
        postgresMajor: 16
      })
    );
    expect(screen.getByTestId("external-archive-feedback")).toHaveTextContent("Registered xba_1");
  });
});
