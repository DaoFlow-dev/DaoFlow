// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogsTab from "./LogsTab";
import MonitoringTab from "./MonitoringTab";
import TerminalTab from "./TerminalTab";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new Event("close"));
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError() {
    this.readyState = MockWebSocket.CLOSED;
    this.onerror?.(new Event("error"));
  }
}

describe("service detail observability tabs", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    cleanup();
    MockWebSocket.instances = [];
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
    Element.prototype.scrollIntoView = vi.fn();
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads container stats from the authenticated observability endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          cpuPercent: 12.5,
          memoryUsageMB: 512,
          memoryLimitMB: 2048,
          memoryPercent: 25,
          networkRxMB: 1500,
          networkTxMB: 256,
          blockReadMB: 0.01,
          blockWriteMB: 3,
          pids: 14,
          uptime: "1h 15m",
          restartCount: 2
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    render(<MonitoringTab serviceId="svc_api" serviceName="api" />);

    await waitFor(() => {
      expect(screen.getByTestId("monitoring-cpu-svc_api")).toHaveTextContent("12.5%");
    });
    expect(screen.getByTestId("monitoring-memory-svc_api")).toHaveTextContent("512 / 2048 MB");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/container-stats/svc_api", {
      credentials: "same-origin"
    });
  });

  it("surfaces the not-running state and allows retrying metrics fetches", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "NOT_RUNNING", error: "No running container metrics." }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cpuPercent: 8.1,
            memoryUsageMB: 256,
            memoryLimitMB: 1024,
            memoryPercent: 25,
            networkRxMB: 10,
            networkTxMB: 5,
            blockReadMB: 0,
            blockWriteMB: 0,
            pids: 4,
            uptime: "50s",
            restartCount: 0
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    render(<MonitoringTab serviceId="svc_worker" serviceName="worker" />);

    expect(await screen.findByTestId("monitoring-status-svc_worker")).toHaveTextContent(
      "Container not running"
    );

    fireEvent.click(screen.getByTestId("monitoring-retry-svc_worker"));

    await waitFor(() => {
      expect(screen.getByTestId("monitoring-cpu-svc_worker")).toHaveTextContent("8.1%");
    });
  });

  it("connects the logs tab to the service log websocket and renders streamed lines", async () => {
    render(<LogsTab serviceId="svc_logs" serviceName="logs-service" />);

    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toContain("/ws/container-logs");
    expect(socket?.url).toContain("serviceId=svc_logs");
    expect(socket?.url).toContain("tail=200");

    socket?.emitOpen();
    socket?.emitMessage(
      JSON.stringify({
        timestamp: "2026-03-20T03:00:00.000Z",
        message: "boot complete",
        stream: "stdout"
      })
    );

    expect(await screen.findByText("boot complete")).toBeInTheDocument();
    expect(screen.getByTestId("logs-status-svc_logs")).toHaveTextContent("Live");
  });

  it("connects the terminal tab by serviceId and forwards terminal input over the websocket", async () => {
    render(<TerminalTab serviceId="svc_term" />);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain("/ws/docker-terminal");
    expect(MockWebSocket.instances[0]?.url).toContain("serviceId=svc_term");
    expect(MockWebSocket.instances[0]?.url).toContain("shell=bash");

    MockWebSocket.instances[0]?.emitOpen();
    expect(await screen.findByTestId("terminal-status-svc_term")).toHaveTextContent("Connected");

    const input = screen.getByLabelText("Terminal input");
    expect(input).not.toBeNull();

    fireEvent.keyDown(input, { key: "l" });
    fireEvent.keyDown(input, { key: "s" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(MockWebSocket.instances[0]?.sent).toEqual(["l", "s", "\n"]);
  });
});
