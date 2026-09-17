import { execFile, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(() => { throw new Error("unexpected child process"); }),
  spawn: vi.fn(() => { throw new Error("unexpected child process"); }),
}));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("source-only updates", () => {
  it.each([[], ["--check"], ["--help"]])("blocks registry updates with args %j", async (...args: string[]) => {
    const fetchMock = vi.fn(() => { throw new Error("unexpected registry request"); });
    vi.stubGlobal("fetch", fetchMock);
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    process.argv = [process.execPath, "dist/bin/linear-axi.js", "update", ...args, "--json"];

    await main();

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(output.mock.calls.map(([text]) => text).join(""))).toEqual({
      code: "UPDATE_ERROR",
      error: "registry updates are disabled because this project is not published to npm",
      help: ["update your source checkout using https://github.com/schmidthole/linear-axi#install"],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
