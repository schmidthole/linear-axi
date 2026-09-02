import { AxiError, installSessionStartHooks, sessionStartHookStatus, uninstallSessionStartHooks } from "axi-sdk-js";
import { parseArgs, stringFlag, type CommandDefinition } from "../args.js";
import type { OutputRecord } from "../output.js";

const SETUP_HELP = `usage: linear-axi setup <hooks|status|remove> [--scope user|project]
subcommands[3]:
  hooks   Install or repair SessionStart integration for Claude Code, Codex, and OpenCode
  status  Inspect integration status without writing
  remove  Remove only hooks managed by linear-axi
flags:
  --scope <user|project>  Installation scope (default user)
examples:
  linear-axi setup hooks
  linear-axi setup hooks --scope project
  linear-axi setup status
`;

export async function setupCommand(args: string[]): Promise<OutputRecord | string> {
  const action = args[0]; if (!action || action === "--help" || args.includes("--help")) return SETUP_HELP;
  const definition: CommandDefinition = { usage: `linear-axi setup ${action}`, description: `${action} linear-axi session hooks`, flags: { "--scope": { type: "string", description: "user or project" } } };
  const parsed = parseArgs(args.slice(1), definition); const rawScope = stringFlag(parsed, "--scope") ?? "user"; if (rawScope !== "user" && rawScope !== "project") throw new AxiError("--scope must be user or project", "VALIDATION_ERROR"); const options: { marker: string; binaryNames: string[]; scope: "user" | "project" } = { marker: "linear-axi", binaryNames: ["linear-axi"], scope: rawScope };
  if (action === "hooks") { await installSessionStartHooks(options); return { setup: "hooks installed or already up to date", scope: rawScope, status: sessionStartHookStatus(options) }; }
  if (action === "status") return { setup: "hook status", scope: rawScope, status: sessionStartHookStatus(options) };
  if (action === "remove") { await uninstallSessionStartHooks(options); return { setup: "managed hooks removed", scope: rawScope, status: sessionStartHookStatus(options) }; }
  throw new AxiError(`Unknown setup action: ${action}`, "VALIDATION_ERROR", ["Use hooks, status, or remove"]);
}
