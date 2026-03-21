// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectEnvironmentsPanel } from "./ProjectEnvironmentsPanel";

describe("ProjectEnvironmentsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("creates an environment with parsed Compose overrides", () => {
    const onCreate = vi.fn();

    render(
      <ProjectEnvironmentsPanel
        projectId="proj_123"
        environments={[]}
        servers={[{ id: "srv_1", name: "edge-1", host: "edge-1.example.com" }]}
        createPending={false}
        updatePending={false}
        deletePending={false}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("project-environments-create-trigger"));

    fireEvent.change(screen.getByTestId("project-environment-name"), {
      target: { value: "staging" }
    });
    fireEvent.change(screen.getByTestId("project-environment-compose-files"), {
      target: { value: "compose.yaml, compose.staging.yaml" }
    });
    fireEvent.change(screen.getByTestId("project-environment-compose-profiles"), {
      target: { value: "web, workers" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Environment" }));

    expect(onCreate).toHaveBeenCalledWith({
      projectId: "proj_123",
      name: "staging",
      targetServerId: undefined,
      composeFiles: ["compose.yaml", "compose.staging.yaml"],
      composeProfiles: ["web", "workers"]
    });
  });

  it("prefills edit state and confirms deletion", async () => {
    const onDelete = vi.fn();

    render(
      <ProjectEnvironmentsPanel
        projectId="proj_123"
        environments={[
          {
            id: "env_123",
            name: "production",
            status: "active",
            statusTone: "healthy",
            targetServerId: "srv_1",
            composeFiles: ["compose.prod.yaml"],
            composeProfiles: ["web"],
            serviceCount: 2
          }
        ]}
        servers={[{ id: "srv_1", name: "edge-1", host: "edge-1.example.com" }]}
        createPending={false}
        updatePending={false}
        deletePending={false}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByTestId("project-environment-edit-env_123"));

    expect(await screen.findByDisplayValue("production")).toBeVisible();
    expect(screen.getByDisplayValue("compose.prod.yaml")).toBeVisible();
    expect(screen.getByDisplayValue("web")).toBeVisible();

    fireEvent.click(screen.getByTestId("project-environment-delete-env_123"));
    fireEvent.click(await screen.findByTestId("project-environment-delete-confirm-env_123"));

    expect(onDelete).toHaveBeenCalledWith("env_123");
  });
});
