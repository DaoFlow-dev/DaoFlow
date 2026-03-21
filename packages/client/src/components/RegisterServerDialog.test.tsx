// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RegisterServerDialog } from "./RegisterServerDialog";

describe("RegisterServerDialog", () => {
  it("submits docker-swarm-manager when the operator selects it", () => {
    const onSubmit = vi.fn();

    render(
      <RegisterServerDialog
        open={true}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        isPending={false}
      />
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "swarm-mgr-1" } });
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "10.0.0.25" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Target kind" }));
    fireEvent.click(screen.getByRole("option", { name: "docker-swarm-manager" }));
    fireEvent.click(screen.getByTestId("register-server-submit"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "swarm-mgr-1",
        host: "10.0.0.25",
        kind: "docker-swarm-manager"
      })
    );
    expect(screen.getByTestId("register-server-kind-note")).toHaveTextContent(
      "Swarm manager targets run stack deploy and rollback through `docker stack`."
    );
  });
});
