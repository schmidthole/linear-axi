import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

const bin = "dist/bin/linear-axi.js";

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: { ...process.env, LINEAR_API_KEY: "", LINEAR_ACCESS_TOKEN: "", ...env } });
}

describe("CLI contract", () => {
  it("prints a bare version for every version alias", () => {
    for (const flag of ["-v", "-V", "--version"]) {
      const result = run([flag]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("0.1.0\n");
    }
  });

  it("shows concise self-describing help", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("commands[7]");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).not.toContain("built-in");
    expect(result.stdout).not.toContain("latest published");
  });

  it("validates usage before authentication and emits JSON errors on request", () => {
    const result = run(["issue", "create", "--json"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "VALIDATION_ERROR", error: "--team is required" });
  });

  it("fails secure when both credentials are set and never prints them", () => {
    const result = run(["issue", "list", "--json"], { LINEAR_API_KEY: "lin_api_cli_secret", LINEAR_ACCESS_TOKEN: "cli-oauth-secret" });
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "AUTH_ERROR", error: "Both LINEAR_API_KEY and LINEAR_ACCESS_TOKEN are set" });
    expect(result.stdout + result.stderr).not.toMatch(/lin_api_cli_secret|cli-oauth-secret/);
  });

  it("names both credential options when neither is set", () => {
    const result = run(["issue", "list", "--json"]);
    expect(result.status).not.toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({ code: "AUTH_ERROR", error: "LINEAR_API_KEY or LINEAR_ACCESS_TOKEN is not set" });
    expect(output.help.join(" ")).toContain("LINEAR_ACCESS_TOKEN");
  });

  it("rejects unknown flags", () => {
    const result = run(["issue", "list", "--stat", "open"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Unknown flag --stat");
  });

  it("keeps the version fast path close to the node process floor", () => {
    const measure = (argv: string[]) => {
      const start = performance.now();
      const result = spawnSync(process.execPath, argv, { encoding: "utf8" });
      expect(result.status).toBe(0);
      return performance.now() - start;
    };
    const floor = Math.min(...Array.from({ length: 3 }, () => measure(["-e", "console.log(1)"])));
    const version = Math.min(...Array.from({ length: 3 }, () => measure([bin, "--version"])));
    expect(version).toBeLessThan(floor * 4 + 25);
  });
});
