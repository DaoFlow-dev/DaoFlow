// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UsersSettingsTab } from "./UsersSettingsTab";

describe("UsersSettingsTab", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows current access, pending invites, and submits new invites for admins", () => {
    let submittedInvite: { email: string; role: string } | null = null;

    render(
      <UsersSettingsTab
        isAdmin={true}
        isLoading={false}
        principals={[
          {
            id: "user_1",
            name: "Alex Admin",
            email: "alex@daoflow.local",
            type: "user",
            accessRole: "admin",
            status: "active",
            createdAt: "2026-03-21T00:00:00.000Z"
          },
          {
            id: "principal_1",
            name: "Ops Agent",
            type: "agent",
            accessRole: "agent",
            status: "active",
            createdAt: "2026-03-21T00:00:00.000Z"
          }
        ]}
        invites={[
          {
            id: "invite_1",
            email: "new-operator@daoflow.local",
            role: "operator",
            invitedByEmail: "owner@daoflow.local",
            expiresAt: "2026-03-29T00:00:00.000Z"
          }
        ]}
        inviteStatus="idle"
        feedback="Invite created."
        onInvite={(input) => {
          submittedInvite = input;
        }}
      />
    );

    expect(screen.getByTestId("users-feedback")).toHaveTextContent("Invite created.");
    expect(screen.getByTestId("users-access-role-user_1")).toHaveTextContent("admin");
    expect(screen.getByText("Ops Agent")).toBeVisible();
    expect(screen.getByText("new-operator@daoflow.local")).toBeVisible();
    expect(screen.getByTestId("users-invite-trigger")).toBeVisible();

    fireEvent.click(screen.getByTestId("users-invite-trigger"));
    fireEvent.change(screen.getByTestId("users-invite-email"), {
      target: { value: "dev@daoflow.local" }
    });
    fireEvent.click(screen.getByTestId("users-invite-role-select"));
    fireEvent.click(screen.getByRole("option", { name: /Developer/ }));
    fireEvent.click(screen.getByTestId("users-invite-submit"));

    expect(submittedInvite).toEqual({
      email: "dev@daoflow.local",
      role: "developer"
    });
  });

  it("keeps the users tab read-only for non-admin viewers", () => {
    render(
      <UsersSettingsTab
        isAdmin={false}
        isLoading={false}
        principals={[
          {
            id: "principal_1",
            name: "Ops Agent",
            type: "agent",
            accessRole: "agent",
            status: "active",
            createdAt: "2026-03-21T00:00:00.000Z"
          }
        ]}
        invites={[]}
        inviteStatus="idle"
        feedback={null}
        onInvite={() => undefined}
      />
    );

    expect(screen.queryByTestId("users-invite-trigger")).toBeNull();
    expect(screen.getByText(/Invite teammates, review current access/)).toBeVisible();
    expect(screen.getByText("Ops Agent")).toBeVisible();
  });

  it("keeps the invite dialog open and shows the error when sending fails", () => {
    const { rerender } = render(
      <UsersSettingsTab
        isAdmin={true}
        isLoading={false}
        principals={[]}
        invites={[]}
        inviteStatus="idle"
        feedback={null}
        onInvite={() => undefined}
      />
    );

    fireEvent.click(screen.getByTestId("users-invite-trigger"));
    fireEvent.change(screen.getByTestId("users-invite-email"), {
      target: { value: "blocked@daoflow.local" }
    });
    fireEvent.click(screen.getByTestId("users-invite-submit"));

    rerender(
      <UsersSettingsTab
        isAdmin={true}
        isLoading={false}
        principals={[]}
        invites={[]}
        inviteStatus="pending"
        feedback={null}
        onInvite={() => undefined}
      />
    );

    rerender(
      <UsersSettingsTab
        isAdmin={true}
        isLoading={false}
        principals={[]}
        invites={[]}
        inviteStatus="error"
        feedback="That email already belongs to an existing DaoFlow user."
        onInvite={() => undefined}
      />
    );

    expect(screen.getByTestId("users-invite-email")).toBeVisible();
    expect(screen.getByTestId("users-invite-error-feedback")).toHaveTextContent(
      "That email already belongs to an existing DaoFlow user."
    );
  });
});
