import { describe, expect, it } from "vitest";
import { listOutput, selectFields, truncate } from "../src/output.js";

describe("output helpers", () => {
  it("reports definitive empty states", () => {
    expect(listOutput("issues", { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false } }, [], { limit: 50, command: "linear-axi issue list" })).toMatchObject({ count: 0, issues: "0 issues found" });
  });

  it("reports page size and total", () => {
    expect(listOutput("issues", { nodes: [{ id: 1 }], totalCount: 9, pageInfo: { hasNextPage: true, endCursor: "c" } }, [{ id: 1 }], { limit: 1, command: "linear-axi issue list" }).count).toBe("1 of 9 total");
  });

  it("truncates with total size and validates requested fields", () => {
    expect(truncate("abcdef", 3)).toEqual({ text: "abc... (truncated, 6 chars total)", truncated: true });
    expect(() => selectFields({ id: "1" }, "bogus", ["id"], ["id"])).toThrow("Unknown output field");
  });
});
