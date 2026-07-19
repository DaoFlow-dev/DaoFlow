import { describe, expect, it } from "vitest";
import { getInventoryTone } from "./tone-utils";

describe("getInventoryTone", () => {
  it("maps webhook recovery terminal and in-progress states", () => {
    expect(getInventoryTone("completed")).toBe("healthy");
    expect(getInventoryTone("succeeded")).toBe("healthy");
    expect(getInventoryTone("processing")).toBe("running");
    expect(getInventoryTone("partial")).toBe("running");
    expect(getInventoryTone("expired")).toBe("failed");
  });
});
