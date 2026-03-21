// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UsersSettingsTab } from "./UsersSettingsTab";

describe("UsersSettingsTab", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders principal inventory without a broken invite CTA", () => {
    render(
      <UsersSettingsTab
        isAdmin={true}
        isLoading={false}
        principals={[
          {
            id: "principal_1",
            name: "Ops Agent",
            type: "agent",
            status: "active",
            createdAt: "2026-03-21T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(screen.queryByRole("button", { name: "Invite User" })).toBeNull();
    expect(screen.getByText(/Create automation identities from the Agents page\./)).toBeVisible();
    expect(screen.getByText("Ops Agent")).toBeVisible();
  });
});
