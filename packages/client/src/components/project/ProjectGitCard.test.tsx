// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ProjectGitCard } from "./ProjectGitCard";

describe("ProjectGitCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("saves edited Git automation settings", () => {
    const onSaveSettings = vi.fn();

    render(
      <ProjectGitCard
        config={{}}
        repoUrl="https://github.com/DaoFlow-dev/DaoFlow"
        repoFullName="DaoFlow-dev/DaoFlow"
        defaultBranch="main"
        autoDeployBranch="main"
        autoDeploy={false}
        onSaveSettings={onSaveSettings}
      />
    );

    fireEvent.change(screen.getByLabelText("Default branch"), {
      target: { value: "release" }
    });
    fireEvent.change(screen.getByLabelText("Auto-deploy branch"), {
      target: { value: "release" }
    });
    fireEvent.click(screen.getByLabelText("Auto-deploy"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSaveSettings).toHaveBeenCalledWith({
      defaultBranch: "release",
      autoDeploy: true,
      autoDeployBranch: "release"
    });
  });

  it("keeps save disabled until Git settings change", () => {
    render(
      <ProjectGitCard
        config={{}}
        repoUrl="https://gitlab.example.com/example/app"
        defaultBranch="main"
        autoDeployBranch="main"
        autoDeploy={true}
        onSaveSettings={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Auto-deploy branch"), {
      target: { value: "staging" }
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
