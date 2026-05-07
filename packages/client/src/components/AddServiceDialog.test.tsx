// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AddServiceDialog from "./AddServiceDialog";

const { createServiceUseMutationMock, createManagedDatabaseUseMutationMock } = vi.hoisted(() => ({
  createServiceUseMutationMock: vi.fn(),
  createManagedDatabaseUseMutationMock: vi.fn()
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    createService: {
      useMutation: createServiceUseMutationMock
    },
    createManagedDatabase: {
      useMutation: createManagedDatabaseUseMutationMock
    }
  }
}));

describe("AddServiceDialog", () => {
  const createServiceMutate = vi.fn();
  const createManagedDatabaseMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createServiceUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: createServiceMutate
    });
    createManagedDatabaseUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: createManagedDatabaseMutate
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderDialog() {
    return render(
      <AddServiceDialog
        open={true}
        onOpenChange={vi.fn()}
        projectId="proj_123"
        initialEnvironmentId="env_prod"
        environments={[
          {
            id: "env_prod",
            name: "production",
            targetServerId: "srv_123"
          }
        ]}
        onCreated={vi.fn()}
      />
    );
  }

  it("creates a managed database request from the database mode", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("add-service-mode-database"));
    fireEvent.change(screen.getByTestId("managed-database-kind"), {
      target: { value: "mysql" }
    });
    fireEvent.change(screen.getByTestId("managed-database-password"), {
      target: { value: "app-secret" }
    });
    fireEvent.click(screen.getByTestId("add-service-submit"));

    await waitFor(() => {
      expect(createManagedDatabaseMutate).toHaveBeenCalledWith({
        kind: "mysql",
        projectId: "proj_123",
        environmentName: "production",
        serverId: "srv_123",
        name: "mysql",
        databaseName: "app",
        username: "app",
        password: "app-secret",
        port: "3306"
      });
    });
    expect(createServiceMutate).not.toHaveBeenCalled();
  });
});
