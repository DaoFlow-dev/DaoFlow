// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveSessionsCard } from "./ActiveSessionsCard";

describe("ActiveSessionsCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("invokes the revoke handler from the active sessions action", () => {
    const onRevokeOtherSessions = vi.fn();

    render(
      <ActiveSessionsCard
        isRevokingOtherSessions={false}
        onRevokeOtherSessions={onRevokeOtherSessions}
      />
    );

    fireEvent.click(screen.getByTestId("active-sessions-revoke-other"));

    expect(onRevokeOtherSessions).toHaveBeenCalledTimes(1);
  });

  it("disables the revoke action while revocation is in progress", () => {
    render(<ActiveSessionsCard isRevokingOtherSessions onRevokeOtherSessions={vi.fn()} />);

    expect(screen.getByTestId("active-sessions-revoke-other")).toBeDisabled();
  });
});
