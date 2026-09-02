import { AxiError, exitCodeForError, runAxiCli } from "axi-sdk-js";
import { apiCommand } from "./commands/api.js";
import { documentCommand } from "./commands/document.js";
import { initiativeCommand } from "./commands/initiative.js";
import { issueCommand } from "./commands/issue.js";
import { lookupCommand } from "./commands/lookup.js";
import { projectCommand } from "./commands/project.js";
import { setupCommand } from "./commands/setup.js";
import { attachTotalCount, LinearClient, type Connection } from "./client.js";
import { ISSUE_LIST_SELECTION } from "./graphql.js";
import { TOP_LEVEL_HELP } from "./help.js";
import { compact, type OutputRecord } from "./output.js";
import { VERSION } from "./version.js";

type AxiRenderable = string | Record<string, unknown>;
type Handler = (args: string[], client: LinearClient) => Promise<AxiRenderable>;

export async function main(): Promise<void> {
  const originalArgv = process.argv.slice(2);
  const jsonMode = originalArgv.includes("--json");
  const argv = originalArgv.filter((arg) => arg !== "--json");
  const wrap = (handler: Handler) => async (args: string[]): Promise<AxiRenderable> => {
    const output = await handler(args, new LinearClient());
    return jsonMode && typeof output !== "string" ? JSON.stringify(output, null, 2) : output;
  };

  await runAxiCli({
    description: "Manage Linear issues, projects, initiatives, and documents",
    version: VERSION,
    packageName: "linear-axi",
    argv,
    topLevelHelp: TOP_LEVEL_HELP,
    home: async () => {
      const output = await home(new LinearClient());
      return jsonMode ? JSON.stringify(output, null, 2) : output;
    },
    commands: {
      issue: wrap(issueCommand),
      project: wrap(projectCommand),
      initiative: wrap(initiativeCommand),
      document: wrap(documentCommand),
      lookup: wrap(lookupCommand),
      api: wrap(apiCommand),
      setup: async (args) => {
        const output = await setupCommand(args);
        return jsonMode && typeof output !== "string" ? JSON.stringify(output, null, 2) : output;
      },
    },
    formatError: (error) => formatError(error, jsonMode),
    renderUnknownCommand: (command) => jsonMode
      ? `${JSON.stringify({ error: `Unknown command: ${command}`, code: "VALIDATION_ERROR", help: ["Run `linear-axi --help`"] }, null, 2)}\n`
      : `error: Unknown command: ${command}\ncode: VALIDATION_ERROR\nhelp[1]: Run \`linear-axi --help\`\n`,
  });
}

async function home(client: LinearClient): Promise<OutputRecord> {
  const data = await client.request<{ viewer: { id: string; name: string; email: string }; issues: Connection<Record<string, unknown>> }>(
    `query Home { viewer { id name email } issues(first: 10, filter: { assignee: { isMe: { eq: true } } }, orderBy: updatedAt) { nodes { ${ISSUE_LIST_SELECTION} } pageInfo { hasNextPage endCursor } } }`,
  );
  const issues = data.issues.nodes.map((raw) => {
    const state = raw.state as { name?: string } | undefined;
    return compact({ identifier: raw.identifier, title: raw.title, status: state?.name, priority: raw.priority });
  });
  await attachTotalCount(data.issues, async (after) => { const page = await client.request<{ issues: Connection<{ id: string }> }>("query HomeCount($after: String!) { issues(first: 250, after: $after, filter: { assignee: { isMe: { eq: true } } }, orderBy: updatedAt) { nodes { id } pageInfo { hasNextPage endCursor } } }", { after }); return page.issues; }, { startsAtBeginning: true });
  return {
    viewer: { name: data.viewer.name, email: data.viewer.email },
    count: `${issues.length} of ${data.issues.totalCount ?? issues.length} assigned issues`,
    issues: issues.length > 0 ? issues : "0 assigned issues found",
    help: issues.length > 0
      ? ["Run `linear-axi issue get <identifier>` for details", "Run `linear-axi issue list --assignee me` for all assigned issues"]
      : ["Run `linear-axi issue list` to browse workspace issues", "Run `linear-axi issue create --help` to create an issue"],
  };
}

function formatError(error: unknown, jsonMode: boolean): { output: string; exitCode: number } {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof AxiError ? error.code : "UNKNOWN";
  const help = error instanceof AxiError ? error.suggestions : [];
  const exitCode = exitCodeForError(error);
  if (jsonMode) return { output: `${JSON.stringify({ error: message, code, ...(help.length ? { help } : {}) }, null, 2)}\n`, exitCode };
  const lines = [`error: ${message}`, `code: ${code}`];
  if (help.length) lines.push(`help[${help.length}]:`, ...help.map((item) => `  ${item}`));
  return { output: `${lines.join("\n")}\n`, exitCode };
}
