// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationChannelsPage from "./NotificationChannelsPage";

const {
  listChannelsUseQueryMock,
  createChannelUseMutationMock,
  deleteChannelUseMutationMock,
  toggleChannelUseMutationMock,
  testChannelUseMutationMock,
  invalidateListChannelsMock,
  invalidateDeliveryLogsMock
} = vi.hoisted(() => ({
  listChannelsUseQueryMock: vi.fn(),
  createChannelUseMutationMock: vi.fn(),
  deleteChannelUseMutationMock: vi.fn(),
  toggleChannelUseMutationMock: vi.fn(),
  testChannelUseMutationMock: vi.fn(),
  invalidateListChannelsMock: vi.fn(),
  invalidateDeliveryLogsMock: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      listChannels: { invalidate: invalidateListChannelsMock },
      listDeliveryLogs: { invalidate: invalidateDeliveryLogsMock }
    }),
    listChannels: {
      useQuery: listChannelsUseQueryMock
    },
    createChannel: {
      useMutation: createChannelUseMutationMock
    },
    deleteChannel: {
      useMutation: deleteChannelUseMutationMock
    },
    toggleChannel: {
      useMutation: toggleChannelUseMutationMock
    },
    testChannel: {
      useMutation: testChannelUseMutationMock
    }
  }
}));

describe("NotificationChannelsPage", () => {
  function renderPage() {
    return render(
      <MemoryRouter>
        <NotificationChannelsPage />
      </MemoryRouter>
    );
  }

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    invalidateListChannelsMock.mockReset();
    invalidateDeliveryLogsMock.mockReset();
    invalidateListChannelsMock.mockResolvedValue(undefined);
    invalidateDeliveryLogsMock.mockResolvedValue(undefined);

    listChannelsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "ntf_ops",
          name: "Ops Alerts",
          channelType: "generic_webhook",
          webhookUrl: "https://hooks.example.com/ops",
          projectFilter: "DaoFlow",
          environmentFilter: "production",
          enabled: true,
          eventSelectors: ["deploy.*", "approval.*"],
          createdAt: "2026-03-20T12:00:00.000Z"
        }
      ],
      isLoading: false
    });
    createChannelUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    deleteChannelUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    toggleChannelUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    testChannelUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
  });

  it("wires the test button to the test notification mutation", () => {
    const mutate = vi.fn();
    testChannelUseMutationMock.mockReturnValue({ isPending: false, mutate });

    renderPage();

    fireEvent.click(screen.getByTestId("notification-channel-test-ntf_ops"));

    expect(mutate).toHaveBeenCalledWith({ id: "ntf_ops" });
    expect(screen.getByText("Project: DaoFlow")).toBeVisible();
    expect(screen.getByText("Env: production")).toBeVisible();
  });
});
