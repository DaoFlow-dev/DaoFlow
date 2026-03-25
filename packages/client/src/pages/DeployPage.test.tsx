// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeployPage from "./DeployPage";

vi.mock("@/components/deploy-page/TemplateDeployPanel", () => ({
  TemplateDeployPanel: () => <div data-testid="deploy-panel-template" />
}));

vi.mock("@/components/deploy-page/RawComposeDeployPanel", () => ({
  RawComposeDeployPanel: () => <div data-testid="deploy-panel-compose" />
}));

vi.mock("@/components/deploy-page/ServiceRolloutPanel", () => ({
  ServiceRolloutPanel: () => <div data-testid="deploy-panel-service" />
}));

describe("DeployPage", () => {
  function renderPage(initialEntry = "/deploy") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <DeployPage />
      </MemoryRouter>
    );
  }

  afterEach(() => {
    cleanup();
  });

  it("defaults to the template source", () => {
    renderPage();

    expect(screen.getByTestId("deploy-page")).toBeVisible();
    expect(screen.getByTestId("deploy-panel-template")).toBeVisible();
  });

  it("switches sources from the selector", () => {
    renderPage();

    fireEvent.click(screen.getByTestId("deploy-source-compose"));
    expect(screen.getByTestId("deploy-panel-compose")).toBeVisible();

    fireEvent.click(screen.getByTestId("deploy-source-service"));
    expect(screen.getByTestId("deploy-panel-service")).toBeVisible();
  });

  it("respects the requested source from the URL", () => {
    renderPage("/deploy?source=service");

    expect(screen.getByTestId("deploy-panel-service")).toBeVisible();
  });
});
