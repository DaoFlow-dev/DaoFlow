// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceLinksCard } from "./ServiceLinksCard";

describe("ServiceLinksCard", () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeTextMock.mockClear();
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders reachable links and supports copy actions", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <ServiceLinksCard
        serviceId="svc_api"
        endpointSummary={{
          status: "healthy",
          statusLabel: "Healthy",
          statusTone: "healthy",
          summary: "app.example.com is live through edge-prod.",
          primaryLabel: "Primary domain",
          primaryHref: "https://app.example.com",
          links: [
            {
              id: "domain-primary",
              kind: "domain",
              label: "Primary domain",
              href: "https://app.example.com",
              copyValue: "https://app.example.com",
              status: "healthy",
              statusLabel: "Healthy",
              statusTone: "healthy",
              summary: "app.example.com is live through edge-prod.",
              isCanonical: true,
              isPublic: true
            }
          ]
        }}
      />
    );

    expect(screen.getByTestId("service-links-summary-svc_api")).toHaveTextContent(
      "app.example.com is live through edge-prod."
    );

    fireEvent.click(screen.getByTestId("service-link-open-svc_api-domain-primary"));
    expect(openSpy).toHaveBeenCalledWith(
      "https://app.example.com",
      "_blank",
      "noopener,noreferrer"
    );

    fireEvent.click(screen.getByTestId("service-link-copy-svc_api-domain-primary"));

    expect(writeTextMock).toHaveBeenCalledWith("https://app.example.com");
  });

  it("shows an honest empty state when no public endpoint is configured", () => {
    render(
      <ServiceLinksCard
        serviceId="svc_worker"
        endpointSummary={{
          status: "unavailable",
          statusLabel: "Unavailable",
          statusTone: "queued",
          summary:
            "No public endpoint is configured for worker. worker still exposes container port 3000.",
          primaryLabel: null,
          primaryHref: null,
          links: []
        }}
      />
    );

    expect(screen.getByTestId("service-links-empty-svc_worker")).toHaveTextContent(
      "No public link yet"
    );
    expect(screen.getByTestId("service-links-empty-svc_worker")).toHaveTextContent(
      "No public endpoint is configured"
    );
  });
});
