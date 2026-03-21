import { describe, expect, it } from "vitest";
import { filterProjects, sortProjects } from "./projects-page-helpers";

describe("projects-page-helpers", () => {
  const projects = [
    {
      id: "proj_2",
      name: "Zebra",
      createdAt: "2026-03-20T00:00:00.000Z",
      status: "healthy"
    },
    {
      id: "proj_1",
      name: "Alpha",
      createdAt: "2026-03-21T00:00:00.000Z",
      status: "healthy"
    }
  ];

  it("filters projects by a case-insensitive name match", () => {
    expect(filterProjects(projects, "alp")).toEqual([projects[1]]);
    expect(filterProjects(projects, "ZEB")).toEqual([projects[0]]);
  });

  it("sorts projects by name", () => {
    expect(sortProjects(projects, "name").map((project) => project.name)).toEqual([
      "Alpha",
      "Zebra"
    ]);
  });

  it("sorts projects by most recent creation time first", () => {
    expect(sortProjects(projects, "recent").map((project) => project.name)).toEqual([
      "Alpha",
      "Zebra"
    ]);
  });
});
