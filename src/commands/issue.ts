import { AxiError } from "axi-sdk-js";
import {
  booleanFlag,
  boundedLimit,
  commandHelp,
  integerFlag,
  LIST_FLAGS,
  parseArgs,
  stringFlag,
  stringsFlag,
  textInput,
  type CommandDefinition,
  type FlagDefinition,
  type ParsedArgs,
} from "../args.js";
import type { Connection, LinearClient } from "../client.js";
import { attachTotalCount, mutationEntity } from "../client.js";
import {
  COMMENT_SELECTION,
  ISSUE_DETAIL_SELECTION,
  ISSUE_LIST_SELECTION,
  RELATION_SELECTION,
  type LinearNode,
} from "../graphql.js";
import { compact, listOutput, names, selectFields, truncate, type OutputRecord } from "../output.js";
import { resolveIssue, resolveLookup, resolveMany } from "../resolve.js";

const ISSUE_HELP = `usage: linear-axi issue <subcommand> [args] [flags]
subcommands[17]:
  list, search <query>, get <issue>, create, update <issue>, comment <issue>,
  assign <issue> <user|none>, state <issue> <state>, priority <issue> <priority>,
  estimate <issue> <points|none>, label <add|remove> <issue> <label>,
  subissue <add|remove|list>, relation <add|remove|list>,
  archive <issue>, unarchive <issue>, delete <issue>
examples:
  linear-axi issue list --team ENG --state "In Progress"
  linear-axi issue search "login timeout" --assignee me
  linear-axi issue create --team ENG --title "Fix login" --priority high
  linear-axi issue update ENG-123 --assignee me --label bug
  linear-axi issue relation add ENG-123 ENG-456 --type blocked-by
  linear-axi issue get ENG-123 --full
`;

const detailAllowed = [
  "id", "identifier", "title", "description", "status", "statusType", "assignee", "creator", "team",
  "project", "priority", "estimate", "dueDate", "labels", "parent", "subIssues", "relations", "comments",
  "url", "createdAt", "updatedAt", "archivedAt", "trashed",
];
const listAllowed = [
  "id", "identifier", "title", "status", "statusType", "assignee", "team", "project", "priority", "estimate",
  "dueDate", "labels", "url", "updatedAt", "archivedAt",
];

const listFlags: Record<string, FlagDefinition> = {
  ...LIST_FLAGS,
  "--team": { type: "string", description: "Team key, name, or ID" },
  "--assignee": { type: "string", description: "User email, name, ID, me, or none" },
  "--state": { type: "string", description: "Workflow state name or ID" },
  "--project": { type: "string", description: "Project name, identifier, ID, or none" },
  "--label": { type: "string", repeatable: true, description: "Required label name or ID" },
  "--priority": { type: "string", description: "no, urgent, high, medium, low, or 0-4" },
};

const LIST_DEFINITION: CommandDefinition = {
  usage: "linear-axi issue list",
  description: "List issues with exact filters",
  flags: listFlags,
  examples: [
    "linear-axi issue list --team ENG --state Todo",
    "linear-axi issue list --assignee me --label bug --limit 100",
    "linear-axi issue list --fields identifier,title,status,priority,url",
  ],
};

const SEARCH_DEFINITION: CommandDefinition = {
  ...LIST_DEFINITION,
  usage: "linear-axi issue search <query>",
  description: "Full-text search issues, optionally narrowed by exact filters",
  positionals: [{ name: "query", required: true }],
  examples: [
    "linear-axi issue search \"login timeout\"",
    "linear-axi issue search oauth --team ENG --assignee me",
  ],
};

const GET_DEFINITION: CommandDefinition = {
  usage: "linear-axi issue get <issue>",
  description: "Get an issue by identifier or UUID",
  positionals: [{ name: "issue", required: true }],
  flags: {
    "--full": { type: "boolean", description: "Do not truncate the description or comments" },
    "--fields": { type: "string", description: "Comma-separated output fields" },
  },
  examples: ["linear-axi issue get ENG-123", "linear-axi issue get ENG-123 --full"],
};

const CREATE_DEFINITION: CommandDefinition = {
  usage: "linear-axi issue create",
  description: "Create an issue",
  flags: {
    "--team": { type: "string", required: true, description: "Team key, name, or ID" },
    "--title": { type: "string", required: true, description: "Issue title" },
    "--description": { type: "string", description: "Markdown description" },
    "--description-file": { type: "string", description: "Read Markdown description from a file" },
    "--assignee": { type: "string", description: "User email, name, ID, or me" },
    "--state": { type: "string", description: "Workflow state name or ID" },
    "--project": { type: "string", description: "Project name, identifier, or ID" },
    "--milestone": { type: "string", description: "Project milestone name or ID" },
    "--parent": { type: "string", description: "Parent issue identifier or ID" },
    "--label": { type: "string", repeatable: true, description: "Label name or ID" },
    "--priority": { type: "string", description: "no, urgent, high, medium, low, or 0-4" },
    "--estimate": { type: "integer", description: "Estimate points" },
    "--due-date": { type: "string", description: "Due date in YYYY-MM-DD format" },
  },
  examples: [
    "linear-axi issue create --team ENG --title \"Fix login\"",
    "linear-axi issue create --team ENG --title \"Fix login\" --assignee me --label bug --priority high",
  ],
};

const UPDATE_DEFINITION: CommandDefinition = {
  usage: "linear-axi issue update <issue>",
  description: "Update one or more issue fields",
  positionals: [{ name: "issue", required: true }],
  flags: {
    "--title": { type: "string", description: "New title" },
    "--description": { type: "string", description: "New Markdown description" },
    "--description-file": { type: "string", description: "Read new description from a file" },
    "--assignee": { type: "string", description: "User reference or none" },
    "--state": { type: "string", description: "Workflow state reference" },
    "--team": { type: "string", description: "Move to team" },
    "--project": { type: "string", description: "Project reference or none" },
    "--milestone": { type: "string", description: "Milestone reference or none" },
    "--parent": { type: "string", description: "Parent issue reference or none" },
    "--label": { type: "string", repeatable: true, description: "Replace all labels (repeatable; use none to clear)" },
    "--priority": { type: "string", description: "no, urgent, high, medium, low, or 0-4" },
    "--estimate": { type: "string", description: "Estimate points or none" },
    "--due-date": { type: "string", description: "YYYY-MM-DD or none" },
  },
  examples: [
    "linear-axi issue update ENG-123 --state Done --assignee me",
    "linear-axi issue update ENG-123 --project none --estimate none",
  ],
};

export async function issueCommand(args: string[], client: LinearClient): Promise<OutputRecord | string> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help") return ISSUE_HELP;
  const rest = args.slice(1);
  if (rest.includes("--help")) return issueSubcommandHelp(subcommand, rest);
  switch (subcommand) {
    case "list": return listIssues(rest, client, false);
    case "search": return listIssues(rest, client, true);
    case "get": return getIssue(rest, client);
    case "create": return createIssue(rest, client);
    case "update": return updateIssue(rest, client);
    case "comment": return commentIssue(rest, client);
    case "assign": return shortcutUpdate(rest, client, "assign");
    case "state": return shortcutUpdate(rest, client, "state");
    case "priority": return shortcutUpdate(rest, client, "priority");
    case "estimate": return shortcutUpdate(rest, client, "estimate");
    case "label": return labelIssue(rest, client);
    case "subissue": return subissueCommand(rest, client);
    case "relation": return relationCommand(rest, client);
    case "archive": return archiveIssue(rest, client, false);
    case "unarchive": return archiveIssue(rest, client, true);
    case "delete": return deleteIssue(rest, client);
    default:
      throw new AxiError(`Unknown issue subcommand: ${subcommand}`, "VALIDATION_ERROR", [
        "Run `linear-axi issue --help` to see available subcommands",
      ]);
  }
}

function issueSubcommandHelp(subcommand: string, rest: string[]): string {
  if (subcommand === "list") return commandHelp(LIST_DEFINITION);
  if (subcommand === "search") return commandHelp(SEARCH_DEFINITION);
  if (subcommand === "get") return commandHelp(GET_DEFINITION);
  if (subcommand === "create") return commandHelp(CREATE_DEFINITION);
  if (subcommand === "update") return commandHelp(UPDATE_DEFINITION);
  const nested = rest[0];
  if (subcommand === "label") return nestedHelp("label", "<add|remove> <issue> <label>");
  if (subcommand === "subissue") return nestedHelp("subissue", "<add|remove|list> <parent> [child]");
  if (subcommand === "relation") return nestedHelp("relation", "<add|remove|list> [issue] [related]");
  return nestedHelp(subcommand, subcommand === "comment" ? "<issue> --body <text>" : "<issue> <value>");
}

function nestedHelp(name: string, suffix: string): string {
  return `usage: linear-axi issue ${name} ${suffix}\nRun \`linear-axi issue --help\` for examples.\n`;
}

async function listIssues(args: string[], client: LinearClient, search: boolean): Promise<OutputRecord> {
  const parsed = parseArgs(args, search ? SEARCH_DEFINITION : LIST_DEFINITION);
  const limit = boundedLimit(parsed);
  const filter = await issueFilter(parsed, client);
  const queryName = search ? "searchIssues" : "issues";
  const termArgument = search ? ", term: $term" : "";
  const data = await client.request<Record<string, Connection<Record<string, unknown>>>>(
    `query IssueList($first: Int!, $after: String, $includeArchived: Boolean!, $filter: IssueFilter${search ? ", $term: String!" : ""}) {
      ${queryName}(first: $first, after: $after, includeArchived: $includeArchived, filter: $filter${termArgument}) {
        nodes { ${ISSUE_LIST_SELECTION} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    {
      first: limit,
      after: stringFlag(parsed, "--after") ?? null,
      includeArchived: booleanFlag(parsed, "--include-archived"),
      filter: Object.keys(filter).length > 0 ? filter : null,
      ...(search ? { term: parsed.positionals[0] } : {}),
    },
  );
  const connection = data[queryName];
  if (!connection) throw new AxiError("Linear returned no issue list data", "API_ERROR");
  const initialAfter = stringFlag(parsed, "--after");
  await attachTotalCount(connection, async (after) => {
    const page = await client.request<Record<string, Connection<{ id: string }>>>(
      `query IssueCount($after: String!, $includeArchived: Boolean!, $filter: IssueFilter${search ? ", $term: String!" : ""}) {
        ${queryName}(first: 250, after: $after, includeArchived: $includeArchived, filter: $filter${termArgument}) {
          nodes { id }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after, includeArchived: booleanFlag(parsed, "--include-archived"), filter: Object.keys(filter).length > 0 ? filter : null, ...(search ? { term: parsed.positionals[0] } : {}) },
    );
    return page[queryName]!;
  }, { startsAtBeginning: initialAfter === undefined });
  const requested = stringFlag(parsed, "--fields");
  const items = connection.nodes.map((node) => selectFields(issueRecord(node), requested, ["identifier", "title", "status", "assignee"], listAllowed));
  const command = search
    ? `linear-axi issue search "${parsed.positionals[0]}"`
    : "linear-axi issue list";
  return listOutput("issues", connection, items, { limit, command, emptyContext: search ? "matching issues" : "issues" });
}

async function issueFilter(parsed: ParsedArgs, client: LinearClient): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};
  let teamId: string | undefined;
  const team = stringFlag(parsed, "--team");
  if (team) {
    teamId = (await resolveLookup(client, "team", team)).id;
    filter.team = { id: { eq: teamId } };
  }
  const assignee = stringFlag(parsed, "--assignee");
  if (assignee) {
    filter.assignee = isNone(assignee)
      ? { null: true }
      : { id: { eq: (await resolveLookup(client, "user", assignee)).id } };
  }
  const state = stringFlag(parsed, "--state");
  if (state) filter.state = { id: { eq: (await resolveLookup(client, "state", state, { teamId })).id } };
  const project = stringFlag(parsed, "--project");
  if (project) {
    filter.project = isNone(project)
      ? { null: true }
      : { id: { eq: (await resolveLookup(client, "project", project)).id } };
  }
  const labels = stringsFlag(parsed, "--label");
  if (labels.length > 0) {
    const ids = await resolveMany(client, "label", labels, { teamId });
    filter.labels = { and: ids.map((id) => ({ some: { id: { eq: id } } })) };
  }
  const priority = stringFlag(parsed, "--priority");
  if (priority) filter.priority = { eq: parsePriority(priority) };
  return filter;
}

async function getIssue(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, GET_DEFINITION);
  const data = await client.request<{ issue: Record<string, unknown> | null }>(
    `query IssueGet($id: String!) { issue(id: $id) { ${ISSUE_DETAIL_SELECTION} } }`,
    { id: parsed.positionals[0] },
  );
  if (!data.issue) throw new AxiError(`Issue not found: ${parsed.positionals[0]}`, "NOT_FOUND");
  const full = booleanFlag(parsed, "--full");
  const item = issueRecord(data.issue, { full });
  const defaults = ["id", "identifier", "title", "description", "status", "assignee", "team", "project", "priority", "estimate", "labels", "parent", "subIssues", "relations", "comments", "url", "updatedAt"];
  const issue = selectFields(item, stringFlag(parsed, "--fields"), defaults, detailAllowed);
  const output: OutputRecord = { issue };
  if (!full && typeof data.issue.description === "string" && data.issue.description.length > 1000) {
    output.help = [`Run \`linear-axi issue get ${parsed.positionals[0]} --full\` for complete content`];
  }
  return output;
}

async function createIssue(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, CREATE_DEFINITION);
  const team = await resolveLookup(client, "team", stringFlag(parsed, "--team")!);
  const input: Record<string, unknown> = {
    teamId: team.id,
    title: stringFlag(parsed, "--title"),
  };
  const description = await textInput(parsed, "--description", "--description-file");
  if (description !== undefined) input.description = description;
  await populateIssueInput(input, parsed, client, team.id, false);
  const data = await client.request<{ issueCreate: { success: boolean; issue: Record<string, unknown> } }>(
    `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_LIST_SELECTION} } } }`,
    { input },
  );
  const issue = mutationEntity(data.issueCreate, "issue") as Record<string, unknown>;
  return { result: "issue created", issue: selectFields(issueRecord(issue), undefined, ["id", "identifier", "title", "status", "url"], listAllowed) };
}

async function updateIssue(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, UPDATE_DEFINITION);
  const issue = await resolveIssue(client, parsed.positionals[0]!);
  const input: Record<string, unknown> = {};
  const title = stringFlag(parsed, "--title");
  if (title !== undefined) input.title = title;
  const description = await textInput(parsed, "--description", "--description-file");
  if (description !== undefined) input.description = description;
  let teamId = issue.team?.id;
  const team = stringFlag(parsed, "--team");
  if (team) {
    teamId = (await resolveLookup(client, "team", team)).id;
    input.teamId = teamId;
  }
  await populateIssueInput(input, parsed, client, teamId, true);
  if (Object.keys(input).length === 0) throw new AxiError("No issue changes provided", "VALIDATION_ERROR", ["Run `linear-axi issue update --help` for writable fields"]);
  const data = await client.request<{ issueUpdate: { success: boolean; issue: Record<string, unknown> } }>(
    `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_LIST_SELECTION} } } }`,
    { id: issue.id, input },
  );
  const updated = mutationEntity(data.issueUpdate, "issue") as Record<string, unknown>;
  return { result: "issue updated", issue: selectFields(issueRecord(updated), undefined, ["id", "identifier", "title", "status", "assignee", "priority", "estimate", "labels"], listAllowed) };
}

async function populateIssueInput(
  input: Record<string, unknown>,
  parsed: ParsedArgs,
  client: LinearClient,
  teamId: string | undefined,
  allowClear: boolean,
): Promise<void> {
  const assignee = stringFlag(parsed, "--assignee");
  if (assignee) input.assigneeId = allowClear && isNone(assignee) ? null : (await resolveLookup(client, "user", assignee)).id;
  const state = stringFlag(parsed, "--state");
  if (state) input.stateId = (await resolveLookup(client, "state", state, { teamId })).id;
  const project = stringFlag(parsed, "--project");
  let projectId: string | undefined;
  if (project) {
    if (allowClear && isNone(project)) input.projectId = null;
    else {
      projectId = (await resolveLookup(client, "project", project)).id;
      input.projectId = projectId;
    }
  }
  const milestone = stringFlag(parsed, "--milestone");
  if (milestone) input.projectMilestoneId = allowClear && isNone(milestone)
    ? null
    : (await resolveLookup(client, "milestone", milestone, { projectId })).id;
  const parent = stringFlag(parsed, "--parent");
  if (parent) input.parentId = allowClear && isNone(parent) ? null : (await resolveIssue(client, parent)).id;
  const labels = stringsFlag(parsed, "--label");
  if (labels.length > 0) input.labelIds = allowClear && labels.length === 1 && isNone(labels[0]!) ? [] : await resolveMany(client, "label", labels, { teamId });
  const priority = stringFlag(parsed, "--priority");
  if (priority) input.priority = parsePriority(priority);
  const rawEstimate = parsed.flags["--estimate"];
  if (typeof rawEstimate === "number") input.estimate = rawEstimate;
  if (typeof rawEstimate === "string") input.estimate = isNone(rawEstimate) ? null : parseNonNegativeInteger(rawEstimate, "estimate");
  const dueDate = stringFlag(parsed, "--due-date");
  if (dueDate) input.dueDate = allowClear && isNone(dueDate) ? null : parseDate(dueDate, "due date");
}

async function commentIssue(args: string[], client: LinearClient): Promise<OutputRecord> {
  const definition: CommandDefinition = {
    usage: "linear-axi issue comment <issue>", description: "Add a comment to an issue",
    positionals: [{ name: "issue", required: true }],
    flags: {
      "--body": { type: "string", description: "Comment Markdown" },
      "--body-file": { type: "string", description: "Read comment Markdown from a file" },
    },
    examples: ["linear-axi issue comment ENG-123 --body \"Fixed in #456\"", "linear-axi issue comment ENG-123 --body-file comment.md"],
  };
  const parsed = parseArgs(args, definition);
  const issue = await resolveIssue(client, parsed.positionals[0]!);
  const body = await textInput(parsed, "--body", "--body-file", { required: true, label: "comment body" });
  const data = await client.request<{ commentCreate: { success: boolean; comment: Record<string, unknown> } }>(
    `mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { ${COMMENT_SELECTION} } } }`,
    { input: { issueId: issue.id, body } },
  );
  const comment = mutationEntity(data.commentCreate, "comment") as Record<string, unknown>;
  return { result: "comment created", comment: commentRecord(comment, false) };
}

async function shortcutUpdate(args: string[], client: LinearClient, action: "assign" | "state" | "priority" | "estimate"): Promise<OutputRecord> {
  const valueName = action === "assign" ? "user|none" : action === "state" ? "state" : action === "priority" ? "priority" : "points|none";
  const definition: CommandDefinition = {
    usage: `linear-axi issue ${action} <issue> <${valueName}>`, description: `${action} an issue`,
    positionals: [{ name: "issue", required: true }, { name: valueName, required: true }],
  };
  const parsed = parseArgs(args, definition);
  const issue = await resolveIssue(client, parsed.positionals[0]!);
  const value = parsed.positionals[1]!;
  const input: Record<string, unknown> = {};
  if (action === "assign") input.assigneeId = isNone(value) ? null : (await resolveLookup(client, "user", value)).id;
  if (action === "state") input.stateId = (await resolveLookup(client, "state", value, { teamId: issue.team?.id })).id;
  if (action === "priority") input.priority = parsePriority(value);
  if (action === "estimate") input.estimate = isNone(value) ? null : parseNonNegativeInteger(value, "estimate");
  const data = await client.request<{ issueUpdate: { success: boolean; issue: Record<string, unknown> } }>(
    `mutation IssueShortcut($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_LIST_SELECTION} } } }`,
    { id: issue.id, input },
  );
  const updated = mutationEntity(data.issueUpdate, "issue") as Record<string, unknown>;
  return { result: `issue ${action === "assign" ? "assigned" : `${action} updated`}`, issue: selectFields(issueRecord(updated), undefined, ["identifier", "title", action === "state" ? "status" : action === "assign" ? "assignee" : action], listAllowed) };
}

async function labelIssue(args: string[], client: LinearClient): Promise<OutputRecord> {
  const definition: CommandDefinition = {
    usage: "linear-axi issue label <add|remove> <issue> <label>", description: "Add or remove an issue label",
    positionals: [{ name: "action", required: true }, { name: "issue", required: true }, { name: "label", required: true }],
  };
  const parsed = parseArgs(args, definition);
  const [action, issueReference, labelReference] = parsed.positionals;
  if (action !== "add" && action !== "remove") throw new AxiError("Label action must be add or remove", "VALIDATION_ERROR");
  const issue = await resolveIssue(client, issueReference!);
  const label = await resolveLookup(client, "label", labelReference!, { teamId: issue.team?.id });
  const mutation = action === "add" ? "issueAddLabel" : "issueRemoveLabel";
  const data = await client.request<Record<string, { success: boolean; issue: Record<string, unknown> }>>(
    `mutation IssueLabel($id: String!, $labelId: String!) { ${mutation}(id: $id, labelId: $labelId) { success issue { ${ISSUE_LIST_SELECTION} } } }`,
    { id: issue.id, labelId: label.id },
  );
  const updated = mutationEntity(data[mutation]!, "issue") as Record<string, unknown>;
  return { result: `label ${action === "add" ? "added" : "removed"}`, issue: selectFields(issueRecord(updated), undefined, ["identifier", "title", "labels"], listAllowed) };
}

async function subissueCommand(args: string[], client: LinearClient): Promise<OutputRecord> {
  const action = args[0];
  if (!action) throw new AxiError("Missing subissue action: add, remove, or list", "VALIDATION_ERROR");
  if (action === "list") {
    const definition: CommandDefinition = { usage: "linear-axi issue subissue list <parent>", description: "List direct sub-issues", positionals: [{ name: "parent", required: true }] };
    const parsed = parseArgs(args.slice(1), definition);
    const parent = await resolveIssue(client, parsed.positionals[0]!);
    const data = await client.request<{ issue: { children: Connection<Record<string, unknown>> } }>(
      `query SubIssues($id: String!) { issue(id: $id) { children(first: 250) { nodes { ${ISSUE_LIST_SELECTION} } pageInfo { hasNextPage endCursor } } } }`, { id: parent.id },
    );
    const items = data.issue.children.nodes.map((node) => selectFields(issueRecord(node), undefined, ["identifier", "title", "status", "assignee"], listAllowed));
    return listOutput("subIssues", data.issue.children, items, { limit: 250, command: `linear-axi issue subissue list ${parsed.positionals[0]}` });
  }
  const definition: CommandDefinition = {
    usage: `linear-axi issue subissue ${action} <parent> <child>`, description: `${action} a sub-issue relationship`,
    positionals: [{ name: "parent", required: true }, { name: "child", required: true }],
  };
  const parsed = parseArgs(args.slice(1), definition);
  if (action !== "add" && action !== "remove") throw new AxiError("Subissue action must be add, remove, or list", "VALIDATION_ERROR");
  const parent = await resolveIssue(client, parsed.positionals[0]!);
  const child = await resolveIssue(client, parsed.positionals[1]!);
  const parentId = action === "add" ? parent.id : null;
  const data = await client.request<{ issueUpdate: { success: boolean; issue: Record<string, unknown> } }>(
    `mutation SubIssue($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_LIST_SELECTION} parent { id identifier title } } } }`,
    { id: child.id, input: { parentId } },
  );
  const updated = mutationEntity(data.issueUpdate, "issue") as Record<string, unknown>;
  return { result: `sub-issue ${action === "add" ? "added" : "removed"}`, issue: compact({ identifier: updated.identifier, title: updated.title, parent: action === "add" ? parent.identifier : "none" }) };
}

async function relationCommand(args: string[], client: LinearClient): Promise<OutputRecord> {
  const action = args[0];
  if (!action) throw new AxiError("Missing relation action: add, remove, or list", "VALIDATION_ERROR");
  if (action === "list") {
    const definition: CommandDefinition = { usage: "linear-axi issue relation list <issue>", description: "List outgoing and incoming issue relations", positionals: [{ name: "issue", required: true }] };
    const parsed = parseArgs(args.slice(1), definition);
    const issue = await resolveIssue(client, parsed.positionals[0]!);
    const data = await client.request<{ issue: { relations: Connection<Record<string, unknown>>; inverseRelations: Connection<Record<string, unknown>> } }>(
      `query Relations($id: String!) { issue(id: $id) { relations(first: 250) { nodes { ${RELATION_SELECTION} } pageInfo { hasNextPage endCursor } } inverseRelations(first: 250) { nodes { ${RELATION_SELECTION} } pageInfo { hasNextPage endCursor } } } }`,
      { id: issue.id },
    );
    return { count: data.issue.relations.nodes.length + data.issue.inverseRelations.nodes.length, relations: relationRecords(data.issue, false) };
  }
  if (action === "remove") {
    const definition: CommandDefinition = { usage: "linear-axi issue relation remove <relation-id>", description: "Delete an issue relation by relation ID", positionals: [{ name: "relation-id", required: true }] };
    const parsed = parseArgs(args.slice(1), definition);
    const data = await client.request<{ issueRelationDelete: { success: boolean; entityId: string } }>(
      "mutation RelationDelete($id: String!) { issueRelationDelete(id: $id) { success entityId } }", { id: parsed.positionals[0] },
    );
    if (!data.issueRelationDelete.success) throw new AxiError("Linear did not remove the relation", "API_ERROR");
    return { result: "issue relation removed", relation: { id: data.issueRelationDelete.entityId } };
  }
  if (action === "add") {
    const definition: CommandDefinition = {
      usage: "linear-axi issue relation add <issue> <related> --type <type>", description: "Create an issue relation",
      positionals: [{ name: "issue", required: true }, { name: "related", required: true }],
      flags: { "--type": { type: "string", required: true, description: "blocks, blocked-by, related, duplicate, or similar" } },
    };
    const parsed = parseArgs(args.slice(1), definition);
    const issue = await resolveIssue(client, parsed.positionals[0]!);
    const related = await resolveIssue(client, parsed.positionals[1]!);
    const requestedType = stringFlag(parsed, "--type")!;
    const valid = ["blocks", "blocked-by", "related", "duplicate", "similar"];
    if (!valid.includes(requestedType)) throw new AxiError(`Invalid relation type: ${requestedType}`, "VALIDATION_ERROR", [`Valid types: ${valid.join(", ")}`]);
    const reverse = requestedType === "blocked-by";
    const input = { type: reverse ? "blocks" : requestedType, issueId: reverse ? related.id : issue.id, relatedIssueId: reverse ? issue.id : related.id };
    const data = await client.request<{ issueRelationCreate: { success: boolean; issueRelation: Record<string, unknown> } }>(
      `mutation RelationCreate($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success issueRelation { ${RELATION_SELECTION} } } }`, { input },
    );
    const relation = mutationEntity(data.issueRelationCreate, "issueRelation") as Record<string, unknown>;
    return { result: "issue relation created", relation: relationRecord(relation, reverse) };
  }
  throw new AxiError("Relation action must be add, remove, or list", "VALIDATION_ERROR");
}

async function archiveIssue(args: string[], client: LinearClient, unarchive: boolean): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: `linear-axi issue ${unarchive ? "unarchive" : "archive"} <issue>`, description: `${unarchive ? "Restore" : "Archive"} an issue`, positionals: [{ name: "issue", required: true }] };
  const parsed = parseArgs(args, definition);
  const issue = await resolveIssue(client, parsed.positionals[0]!);
  const mutation = unarchive ? "issueUnarchive" : "issueArchive";
  const data = await client.request<Record<string, { success: boolean; entity: Record<string, unknown> }>>(
    `mutation IssueArchive($id: String!) { ${mutation}(id: $id) { success entity { ${ISSUE_LIST_SELECTION} } } }`, { id: issue.id },
  );
  const entity = mutationEntity(data[mutation]!, "entity") as Record<string, unknown>;
  return { result: `issue ${unarchive ? "unarchived" : "archived"}`, issue: selectFields(issueRecord(entity), undefined, ["id", "identifier", "title", "archivedAt"], listAllowed) };
}

async function deleteIssue(args: string[], client: LinearClient): Promise<OutputRecord> {
  const definition: CommandDefinition = {
    usage: "linear-axi issue delete <issue>", description: "Move an issue to trash or permanently delete it",
    positionals: [{ name: "issue", required: true }], flags: { "--permanent": { type: "boolean", description: "Permanently delete instead of moving to trash" } },
    examples: ["linear-axi issue delete ENG-123", "linear-axi issue delete ENG-123 --permanent"],
  };
  const parsed = parseArgs(args, definition);
  const issue = await resolveIssue(client, parsed.positionals[0]!);
  const permanent = booleanFlag(parsed, "--permanent");
  const data = await client.request<{ issueDelete: { success: boolean; entity: Record<string, unknown> } }>(
    `mutation IssueDelete($id: String!, $permanent: Boolean!) { issueDelete(id: $id, permanentlyDelete: $permanent) { success entity { id identifier title } } }`,
    { id: issue.id, permanent },
  );
  if (!data.issueDelete.success) throw new AxiError("Linear did not delete the issue", "API_ERROR");
  return { result: permanent ? "issue permanently deleted" : "issue moved to trash", issue: compact({ id: issue.id, identifier: issue.identifier, title: issue.title }) };
}

function issueRecord(raw: Record<string, unknown>, options: { full?: boolean } = {}): OutputRecord {
  const state = raw.state as { name?: string; type?: string } | null | undefined;
  const assignee = raw.assignee as { name?: string; email?: string } | null | undefined;
  const creator = raw.creator as { name?: string; email?: string } | null | undefined;
  const team = raw.team as { key?: string; name?: string } | null | undefined;
  const project = raw.project as { name?: string } | null | undefined;
  const labels = raw.labels as { nodes?: Array<{ name?: string }> } | undefined;
  const parent = raw.parent as { identifier?: string; title?: string } | null | undefined;
  const children = raw.children as { nodes?: Array<Record<string, unknown>> } | undefined;
  const comments = raw.comments as { nodes?: Array<Record<string, unknown>> } | undefined;
  const description = truncate(typeof raw.description === "string" ? raw.description : "", options.full ? Number.MAX_SAFE_INTEGER : 1000).text;
  return compact({
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description,
    status: state?.name,
    statusType: state?.type,
    assignee: assignee?.email ?? assignee?.name ?? "none",
    creator: creator?.email ?? creator?.name,
    team: team?.key ?? team?.name,
    project: project?.name ?? "none",
    priority: raw.priority,
    estimate: raw.estimate,
    dueDate: raw.dueDate,
    labels: names(labels?.nodes),
    parent: parent ? `${parent.identifier ?? ""} ${parent.title ?? ""}`.trim() : "none",
    subIssues: (children?.nodes ?? []).map((child) => compact({ identifier: child.identifier, title: child.title, status: (child.state as { name?: string } | undefined)?.name })),
    relations: relationRecords(raw as { relations?: { nodes?: Array<Record<string, unknown>> }; inverseRelations?: { nodes?: Array<Record<string, unknown>> } }, false),
    comments: (comments?.nodes ?? []).map((comment) => commentRecord(comment, options.full ?? false)),
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    archivedAt: raw.archivedAt,
    trashed: raw.trashed,
  });
}

function commentRecord(raw: Record<string, unknown>, full: boolean): OutputRecord {
  const user = raw.user as { name?: string; email?: string } | null | undefined;
  return compact({
    id: raw.id,
    author: user?.email ?? user?.name,
    body: truncate(typeof raw.body === "string" ? raw.body : "", full ? Number.MAX_SAFE_INTEGER : 800).text,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  });
}

function relationRecords(raw: { relations?: { nodes?: Array<Record<string, unknown>> }; inverseRelations?: { nodes?: Array<Record<string, unknown>> } }, reverse: boolean): OutputRecord[] {
  const outgoing = (raw.relations?.nodes ?? []).map((relation) => relationRecord(relation, reverse));
  const incoming = (raw.inverseRelations?.nodes ?? []).map((relation) => relationRecord(relation, true));
  return [...outgoing, ...incoming];
}

function relationRecord(raw: Record<string, unknown>, inverse: boolean): OutputRecord {
  const type = String(raw.type ?? "related");
  const other = (inverse ? raw.issue : raw.relatedIssue) as { identifier?: string; title?: string } | undefined;
  return compact({
    id: raw.id,
    type: inverse && type === "blocks" ? "blocked-by" : type,
    issue: other?.identifier,
    title: other?.title,
  });
}

function parsePriority(value: string): number {
  const priorities: Record<string, number> = { no: 0, none: 0, urgent: 1, high: 2, medium: 3, low: 4 };
  const normalized = value.toLowerCase();
  const parsed = priorities[normalized] ?? (/^[0-4]$/.test(value) ? Number(value) : undefined);
  if (parsed === undefined) throw new AxiError(`Invalid priority: ${value}`, "VALIDATION_ERROR", ["Use no, urgent, high, medium, low, or 0-4"]);
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new AxiError(`${label} must be a non-negative integer or none`, "VALIDATION_ERROR");
  return Number(value);
}

function parseDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new AxiError(`${label} must use YYYY-MM-DD`, "VALIDATION_ERROR");
  }
  return value;
}

function isNone(value: string): boolean {
  return value.toLowerCase() === "none" || value.toLowerCase() === "null";
}
