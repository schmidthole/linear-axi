import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { parseArgs, type CommandDefinition } from "../src/args.js";

const definition: CommandDefinition = {
  usage: "linear-axi thing create <name>",
  description: "test",
  positionals: [{ name: "name", required: true }],
  flags: {
    "--label": { type: "string", repeatable: true, description: "label" },
    "--limit": { type: "integer", description: "limit" },
    "--force": { type: "boolean", description: "force" },
  },
};

describe("parseArgs", () => {
  it("supports equals values and repeatable flags", () => {
    expect(parseArgs(["item", "--label=bug", "--label", "api", "--limit", "25", "--force"], definition)).toEqual({
      positionals: ["item"],
      flags: { "--label": ["bug", "api"], "--limit": 25, "--force": true },
    });
  });

  it("rejects unknown flags with a self-correcting error", () => {
    expect(() => parseArgs(["item", "--stat", "open"], definition)).toThrowError(AxiError);
    try { parseArgs(["item", "--stat", "open"], definition); } catch (error) {
      expect((error as AxiError).message).toContain("Unknown flag --stat");
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects missing required positionals", () => {
    expect(() => parseArgs([], definition)).toThrow("Missing required argument: name");
  });
});
