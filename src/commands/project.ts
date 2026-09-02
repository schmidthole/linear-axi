import { AxiError } from "axi-sdk-js";
import {
  booleanFlag, boundedLimit, commandHelp, integerFlag, LIST_FLAGS, parseArgs, stringFlag, stringsFlag, textInput,
  type CommandDefinition, type FlagDefinition, type ParsedArgs,
} from "../args.js";
import type { Connection, LinearClient } from "../client.js";
import { attachTotalCount, mutationEntity } from "../client.js";
import { ISSUE_LIST_SELECTION, MILESTONE_SELECTION, PROJECT_DETAIL_SELECTION, PROJECT_LIST_SELECTION, PROJECT_STATUS_SELECTION } from "../graphql.js";
import { compact, listOutput, names, selectFields, truncate, type OutputRecord } from "../output.js";
import { resolveIssue, resolveLookup, resolveMany } from "../resolve.js";

const PROJECT_HELP = `usage: linear-axi project <subcommand> [args] [flags]
subcommands[12]:
  list, search <query>, get <project>, create, update <project>, archive <project>,
  unarchive <project>, delete <project>, add-issue <project> <issue>,
  remove-issue <project> <issue>, status <action>, milestone <action>
status actions[6]: list, set, create, update, archive, unarchive
milestone actions[5]: list, create, update, move, delete
examples:
  linear-axi project list --team ENG
  linear-axi project create --name "Q4 reliability" --team ENG
  linear-axi project status set "Q4 reliability" Planned
  linear-axi project milestone create "Q4 reliability" --name Beta --target-date 2026-10-01
  linear-axi project add-issue "Q4 reliability" ENG-123
`;

const listAllowed = ["id", "slug", "name", "description", "status", "statusType", "lead", "teams", "priority", "startDate", "targetDate", "labels", "url", "updatedAt", "archivedAt", "trashed"];
const detailAllowed = [...listAllowed, "content", "creator", "milestones", "issues", "initiatives", "documents", "createdAt", "completedAt", "canceledAt"];

const projectListFlags: Record<string, FlagDefinition> = {
  ...LIST_FLAGS,
  "--team": { type: "string", description: "Accessible team key, name, or ID" },
  "--status": { type: "string", description: "Project status name or ID" },
  "--lead": { type: "string", description: "Lead user email, name, ID, me, or none" },
  "--priority": { type: "integer", description: "Numeric project priority" },
};
const LIST_DEFINITION: CommandDefinition = {
  usage: "linear-axi project list", description: "List projects with exact filters", flags: projectListFlags,
  examples: ["linear-axi project list --team ENG", "linear-axi project list --status Planned --include-archived"],
};
const SEARCH_DEFINITION: CommandDefinition = {
  ...LIST_DEFINITION, usage: "linear-axi project search <query>", description: "Full-text search projects",
  positionals: [{ name: "query", required: true }],
};
const GET_DEFINITION: CommandDefinition = {
  usage: "linear-axi project get <project>", description: "Get a project by name, slug, or UUID",
  positionals: [{ name: "project", required: true }],
  flags: { "--full": { type: "boolean", description: "Do not truncate description or content" }, "--fields": { type: "string", description: "Comma-separated output fields" } },
};
const CREATE_DEFINITION: CommandDefinition = {
  usage: "linear-axi project create", description: "Create a project",
  flags: {
    "--name": { type: "string", required: true, description: "Project name" },
    "--team": { type: "string", required: true, repeatable: true, description: "Team key, name, or ID" },
    "--description": { type: "string", description: "Short description" },
    "--description-file": { type: "string", description: "Read short description from a file" },
    "--content": { type: "string", description: "Long-form Markdown content" },
    "--content-file": { type: "string", description: "Read long-form content from a file" },
    "--status": { type: "string", description: "Project status name or ID" },
    "--lead": { type: "string", description: "Lead user reference" },
    "--member": { type: "string", repeatable: true, description: "Project member user reference" },
    "--label": { type: "string", repeatable: true, description: "Project label name or ID" },
    "--priority": { type: "integer", description: "Numeric priority" },
    "--start-date": { type: "string", description: "YYYY-MM-DD" },
    "--target-date": { type: "string", description: "YYYY-MM-DD" },
    "--icon": { type: "string", description: "Project icon" },
    "--color": { type: "string", description: "Hex color" },
  },
  examples: ["linear-axi project create --name \"Q4 reliability\" --team ENG", "linear-axi project create --name Migration --team ENG --lead me --target-date 2026-12-01"],
};
const UPDATE_DEFINITION: CommandDefinition = {
  usage: "linear-axi project update <project>", description: "Update project fields",
  positionals: [{ name: "project", required: true }],
  flags: {
    "--name": { type: "string", description: "New project name" },
    "--description": { type: "string", description: "New short description" },
    "--description-file": { type: "string", description: "Read new description from a file" },
    "--content": { type: "string", description: "New long-form Markdown" },
    "--content-file": { type: "string", description: "Read new long-form content from a file" },
    "--status": { type: "string", description: "Project status reference" },
    "--lead": { type: "string", description: "Lead user reference or none" },
    "--team": { type: "string", repeatable: true, description: "Replace accessible teams" },
    "--member": { type: "string", repeatable: true, description: "Replace project members" },
    "--label": { type: "string", repeatable: true, description: "Replace project labels (use none to clear)" },
    "--priority": { type: "string", description: "Numeric priority or none" },
    "--start-date": { type: "string", description: "YYYY-MM-DD or none" },
    "--target-date": { type: "string", description: "YYYY-MM-DD or none" },
    "--icon": { type: "string", description: "Project icon" },
    "--color": { type: "string", description: "Hex color" },
  },
};

export async function projectCommand(args: string[], client: LinearClient): Promise<OutputRecord | string> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help") return PROJECT_HELP;
  const rest = args.slice(1);
  if (rest.includes("--help")) return subcommandHelp(subcommand, rest);
  switch (subcommand) {
    case "list": return listProjects(rest, client, false);
    case "search": return listProjects(rest, client, true);
    case "get": return getProject(rest, client);
    case "create": return createProject(rest, client);
    case "update": return updateProject(rest, client);
    case "archive": return archiveProject(rest, client, false);
    case "unarchive": return archiveProject(rest, client, true);
    case "delete": return deleteProject(rest, client);
    case "add-issue": return projectIssue(rest, client, true);
    case "remove-issue": return projectIssue(rest, client, false);
    case "status": return statusCommand(rest, client);
    case "milestone": return milestoneCommand(rest, client);
    default: throw new AxiError(`Unknown project subcommand: ${subcommand}`, "VALIDATION_ERROR", ["Run `linear-axi project --help`"]);
  }
}

function subcommandHelp(subcommand: string, rest: string[]): string {
  if (subcommand === "list") return commandHelp(LIST_DEFINITION);
  if (subcommand === "search") return commandHelp(SEARCH_DEFINITION);
  if (subcommand === "get") return commandHelp(GET_DEFINITION);
  if (subcommand === "create") return commandHelp(CREATE_DEFINITION);
  if (subcommand === "update") return commandHelp(UPDATE_DEFINITION);
  if (subcommand === "status") return `usage: linear-axi project status <list|set|create|update|archive|unarchive>\n`;
  if (subcommand === "milestone") return `usage: linear-axi project milestone <list|create|update|move|delete>\n`;
  return `usage: linear-axi project ${subcommand} <project>${subcommand.includes("issue") ? " <issue>" : ""}\n`;
}

async function listProjects(args: string[], client: LinearClient, search: boolean): Promise<OutputRecord> {
  const parsed = parseArgs(args, search ? SEARCH_DEFINITION : LIST_DEFINITION);
  const limit = boundedLimit(parsed);
  const filter = await projectFilter(parsed, client);
  const queryName = search ? "searchProjects" : "projects";
  const term = search ? ", term: $term" : "";
  const data = await client.request<Record<string, Connection<Record<string, unknown>>>>(
    `query ProjectList($first: Int!, $after: String, $includeArchived: Boolean!${search ? ", $term: String!" : ", $filter: ProjectFilter"}) {
      ${queryName}(first: $first, after: $after, includeArchived: $includeArchived${search ? "" : ", filter: $filter"}${term}) {
        nodes { ${PROJECT_LIST_SELECTION} } pageInfo { hasNextPage endCursor }
      }
    }`,
    { first: limit, after: stringFlag(parsed, "--after") ?? null, includeArchived: booleanFlag(parsed, "--include-archived"), filter: Object.keys(filter).length ? filter : null, ...(search ? { term: parsed.positionals[0] } : {}) },
  );
  const connection = data[queryName];
  if (!connection) throw new AxiError("Linear returned no project list data", "API_ERROR");
  const initialAfter = stringFlag(parsed, "--after");
  if (!search || Object.keys(filter).length === 0) {
    await attachTotalCount(connection, async (after) => {
      const page = await client.request<Record<string, Connection<{ id: string }>>>(
        `query ProjectCount($after: String!, $includeArchived: Boolean!${search ? ", $term: String!" : ", $filter: ProjectFilter"}) {
          ${queryName}(first: 250, after: $after, includeArchived: $includeArchived${search ? ", term: $term" : ", filter: $filter"}) { nodes { id } pageInfo { hasNextPage endCursor } }
        }`,
        { after, includeArchived: booleanFlag(parsed, "--include-archived"), ...(search ? { term: parsed.positionals[0] } : { filter: Object.keys(filter).length ? filter : null }) },
      );
      return page[queryName]!;
    }, { startsAtBeginning: initialAfter === undefined });
  }
  let nodes = connection.nodes;
  // searchProjects does not accept ProjectFilter. Fetch its ranked result set,
  // then apply exact filters locally so a match on a later page is not lost.
  if (search && Object.keys(filter).length > 0) {
    let allNodes = [...nodes];
    if (initialAfter === undefined) {
      let pageInfo = connection.pageInfo;
      while (pageInfo.hasNextPage && pageInfo.endCursor) {
        const page = await client.request<{ searchProjects: Connection<Record<string, unknown>> }>(`query ProjectSearchFiltered($after: String!, $includeArchived: Boolean!, $term: String!) { searchProjects(first: 250, after: $after, includeArchived: $includeArchived, term: $term) { nodes { ${PROJECT_LIST_SELECTION} } pageInfo { hasNextPage endCursor } } }`, { after: pageInfo.endCursor, includeArchived: booleanFlag(parsed, "--include-archived"), term: parsed.positionals[0] });
        allNodes.push(...page.searchProjects.nodes);
        pageInfo = page.searchProjects.pageInfo;
      }
    }
    nodes = allNodes.filter((node) => projectMatchesResolvedFilter(node, filter));
  }
  const displayed = nodes.slice(0, limit);
  const requested = stringFlag(parsed, "--fields");
  const items = displayed.map((node) => selectFields(projectRecord(node), requested, ["id", "name", "status", "lead"], listAllowed));
  const resultConnection: Connection<Record<string, unknown>> = search && Object.keys(filter).length > 0 && initialAfter === undefined
    ? { nodes: displayed, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null } }
    : { ...connection, nodes: displayed };
  return listOutput("projects", resultConnection, items, { limit, command: search ? `linear-axi project search "${parsed.positionals[0]}"` : "linear-axi project list" });
}

async function projectFilter(parsed: ParsedArgs, client: LinearClient): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};
  const team = stringFlag(parsed, "--team");
  if (team) filter.accessibleTeams = { some: { id: { eq: (await resolveLookup(client, "team", team)).id } } };
  const status = stringFlag(parsed, "--status");
  if (status) filter.status = { id: { eq: (await resolveLookup(client, "project-status", status)).id } };
  const lead = stringFlag(parsed, "--lead");
  if (lead) filter.lead = isNone(lead) ? { null: true } : { id: { eq: (await resolveLookup(client, "user", lead)).id } };
  const priority = integerFlag(parsed, "--priority");
  if (priority !== undefined) filter.priority = { eq: priority };
  return filter;
}

function projectMatchesResolvedFilter(node: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  const teamId = (((filter.accessibleTeams as Record<string, unknown> | undefined)?.some as Record<string, unknown> | undefined)?.id as { eq?: string } | undefined)?.eq;
  const statusId = ((filter.status as Record<string, unknown> | undefined)?.id as { eq?: string } | undefined)?.eq;
  const leadFilter = filter.lead as { id?: { eq?: string }; null?: boolean } | undefined;
  const priority = (filter.priority as { eq?: number } | undefined)?.eq;
  const teams = (node.teams as { nodes?: Array<{ id?: string }> } | undefined)?.nodes ?? [];
  const status = node.status as { id?: string } | null | undefined;
  const lead = node.lead as { id?: string } | null | undefined;
  return (!teamId || teams.some((team) => team.id === teamId))
    && (!statusId || status?.id === statusId)
    && (!leadFilter?.null || !lead)
    && (!leadFilter?.id?.eq || lead?.id === leadFilter.id.eq)
    && (priority === undefined || node.priority === priority);
}

async function getProject(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, GET_DEFINITION);
  const project = await resolveLookup(client, "project", parsed.positionals[0]!);
  const data = await client.request<{ project: Record<string, unknown> | null }>(
    `query ProjectGet($id: String!) { project(id: $id) { ${PROJECT_DETAIL_SELECTION} } }`, { id: project.id },
  );
  if (!data.project) throw new AxiError(`Project not found: ${parsed.positionals[0]}`, "NOT_FOUND");
  const full = booleanFlag(parsed, "--full");
  const item = projectRecord(data.project, full);
  const defaults = ["id", "slug", "name", "description", "content", "status", "lead", "teams", "priority", "startDate", "targetDate", "milestones", "issues", "initiatives", "documents", "url", "updatedAt"];
  const output: OutputRecord = { project: selectFields(item, stringFlag(parsed, "--fields"), defaults, detailAllowed) };
  if (!full && ([data.project.description, data.project.content] as unknown[]).some((value) => typeof value === "string" && value.length > 1000)) output.help = [`Run \`linear-axi project get ${parsed.positionals[0]} --full\` for complete content`];
  return output;
}

async function createProject(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, CREATE_DEFINITION);
  const teamIds = await resolveMany(client, "team", stringsFlag(parsed, "--team"));
  const input: Record<string, unknown> = { name: stringFlag(parsed, "--name"), teamIds };
  await populateProjectInput(input, parsed, client, true);
  const data = await client.request<{ projectCreate: { success: boolean; project: Record<string, unknown> } }>(
    `mutation ProjectCreate($input: ProjectCreateInput!) { projectCreate(input: $input) { success project { ${PROJECT_LIST_SELECTION} } } }`, { input },
  );
  const project = mutationEntity(data.projectCreate, "project") as Record<string, unknown>;
  return { result: "project created", project: selectFields(projectRecord(project), undefined, ["id", "name", "status", "teams", "url"], listAllowed) };
}

async function updateProject(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, UPDATE_DEFINITION);
  const project = await resolveLookup(client, "project", parsed.positionals[0]!);
  const input: Record<string, unknown> = {};
  await populateProjectInput(input, parsed, client, false);
  if (!Object.keys(input).length) throw new AxiError("No project changes provided", "VALIDATION_ERROR", ["Run `linear-axi project update --help`"]);
  const data = await client.request<{ projectUpdate: { success: boolean; project: Record<string, unknown> } }>(
    `mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) { projectUpdate(id: $id, input: $input) { success project { ${PROJECT_LIST_SELECTION} } } }`, { id: project.id, input },
  );
  const updated = mutationEntity(data.projectUpdate, "project") as Record<string, unknown>;
  return { result: "project updated", project: selectFields(projectRecord(updated), undefined, ["id", "name", "status", "lead", "teams", "priority", "targetDate"], listAllowed) };
}

async function populateProjectInput(input: Record<string, unknown>, parsed: ParsedArgs, client: LinearClient, creating: boolean): Promise<void> {
  for (const [flag, key] of [["--name", "name"], ["--icon", "icon"], ["--color", "color"]] as const) {
    const value = stringFlag(parsed, flag); if (value !== undefined) input[key] = value;
  }
  const description = await textInput(parsed, "--description", "--description-file"); if (description !== undefined) input.description = description;
  const content = await textInput(parsed, "--content", "--content-file"); if (content !== undefined) input.content = content;
  const teams = stringsFlag(parsed, "--team"); if (teams.length && !creating) input.teamIds = await resolveMany(client, "team", teams);
  const status = stringFlag(parsed, "--status"); if (status) input.statusId = (await resolveLookup(client, "project-status", status)).id;
  const lead = stringFlag(parsed, "--lead"); if (lead) input.leadId = !creating && isNone(lead) ? null : (await resolveLookup(client, "user", lead)).id;
  const members = stringsFlag(parsed, "--member"); if (members.length) input.memberIds = await resolveMany(client, "user", members);
  const labels = stringsFlag(parsed, "--label"); if (labels.length) input.labelIds = !creating && labels.length === 1 && isNone(labels[0]!) ? [] : await resolveMany(client, "project-label", labels);
  const rawPriority = parsed.flags["--priority"];
  if (typeof rawPriority === "number") input.priority = rawPriority;
  if (typeof rawPriority === "string") input.priority = isNone(rawPriority) ? null : parseInteger(rawPriority, "priority");
  for (const [flag, key] of [["--start-date", "startDate"], ["--target-date", "targetDate"]] as const) {
    const value = stringFlag(parsed, flag); if (value) input[key] = !creating && isNone(value) ? null : parseDate(value);
  }
}

async function archiveProject(args: string[], client: LinearClient, unarchive: boolean): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: `linear-axi project ${unarchive ? "unarchive" : "archive"} <project>`, description: `${unarchive ? "Restore" : "Archive"} a project`, positionals: [{ name: "project", required: true }] };
  const parsed = parseArgs(args, definition);
  const project = await resolveLookup(client, "project", parsed.positionals[0]!);
  const mutation = unarchive ? "projectUnarchive" : "projectDelete";
  const data = await client.request<Record<string, { success: boolean; entity: Record<string, unknown> }>>(
    `mutation ProjectArchive($id: String!) { ${mutation}(id: $id) { success entity { ${PROJECT_LIST_SELECTION} } } }`, { id: project.id },
  );
  const entity = mutationEntity(data[mutation]!, "entity") as Record<string, unknown>;
  return { result: `project ${unarchive ? "unarchived" : "archived"}`, project: selectFields(projectRecord(entity), undefined, ["id", "name", "archivedAt"], listAllowed) };
}

async function deleteProject(args: string[], client: LinearClient): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: "linear-axi project delete <project>", description: "Delete a project through Linear's archive-style projectDelete operation", positionals: [{ name: "project", required: true }] };
  const parsed = parseArgs(args, definition);
  const project = await resolveLookup(client, "project", parsed.positionals[0]!);
  const data = await client.request<{ projectDelete: { success: boolean; entity: Record<string, unknown> } }>(
    "mutation ProjectDelete($id: String!) { projectDelete(id: $id) { success entity { id name archivedAt } } }", { id: project.id },
  );
  if (!data.projectDelete.success) throw new AxiError("Linear did not delete the project", "API_ERROR");
  return { result: "project deleted (archived by Linear API)", project: compact(data.projectDelete.entity) };
}

async function projectIssue(args: string[], client: LinearClient, add: boolean): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: `linear-axi project ${add ? "add" : "remove"}-issue <project> <issue>`, description: `${add ? "Add an issue to" : "Remove an issue from"} a project`, positionals: [{ name: "project", required: true }, { name: "issue", required: true }] };
  const parsed = parseArgs(args, definition);
  const project = await resolveLookup(client, "project", parsed.positionals[0]!);
  const issue = await resolveIssue(client, parsed.positionals[1]!);
  const data = await client.request<{ issueUpdate: { success: boolean; issue: Record<string, unknown> } }>(
    `mutation ProjectIssue($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_LIST_SELECTION} } } }`,
    { id: issue.id, input: { projectId: add ? project.id : null } },
  );
  const updated = mutationEntity(data.issueUpdate, "issue") as Record<string, unknown>;
  return { result: `issue ${add ? "added to" : "removed from"} project`, issue: compact({ identifier: updated.identifier, title: updated.title, project: add ? project.name : "none" }) };
}

async function statusCommand(args: string[], client: LinearClient): Promise<OutputRecord> {
  const action = args[0];
  if (!action) throw new AxiError("Missing project status action", "VALIDATION_ERROR", ["Use list, set, create, update, archive, or unarchive"]);
  const rest = args.slice(1);
  if (action === "list") {
    const definition: CommandDefinition = { usage: "linear-axi project status list", description: "List project statuses", flags: { ...LIST_FLAGS, "--team": { type: "string", description: "Filter by team" } } };
    const parsed = parseArgs(rest, definition); const limit = boundedLimit(parsed); const team = stringFlag(parsed, "--team"); const teamId = team ? (await resolveLookup(client, "team", team)).id : undefined;
    const data = await client.request<{ projectStatuses: Connection<Record<string, unknown>> }>(
      `query ProjectStatuses($first: Int!, $after: String, $includeArchived: Boolean!) { projectStatuses(first: $first, after: $after, includeArchived: $includeArchived) { nodes { ${PROJECT_STATUS_SELECTION} } pageInfo { hasNextPage endCursor } } }`,
      { first: limit, after: stringFlag(parsed, "--after") ?? null, includeArchived: booleanFlag(parsed, "--include-archived") },
    );
    const nodes = teamId ? data.projectStatuses.nodes.filter((node) => (node.team as { id?: string } | null)?.id === teamId) : data.projectStatuses.nodes;
    if (!teamId) await attachTotalCount(data.projectStatuses, async (after) => {
      const page = await client.request<{ projectStatuses: Connection<{ id: string }> }>("query ProjectStatusCount($after: String!, $includeArchived: Boolean!) { projectStatuses(first: 250, after: $after, includeArchived: $includeArchived) { nodes { id } pageInfo { hasNextPage endCursor } } }", { after, includeArchived: booleanFlag(parsed, "--include-archived") }); return page.projectStatuses;
    }, { startsAtBeginning: stringFlag(parsed, "--after") === undefined });
    const items = nodes.map(statusRecord); return listOutput("projectStatuses", { ...data.projectStatuses, nodes }, items, { limit, command: "linear-axi project status list" });
  }
  if (action === "set") {
    const definition: CommandDefinition = { usage: "linear-axi project status set <project> <status>", description: "Set a project's status", positionals: [{ name: "project", required: true }, { name: "status", required: true }] };
    const parsed = parseArgs(rest, definition); const project = await resolveLookup(client, "project", parsed.positionals[0]!); const status = await resolveLookup(client, "project-status", parsed.positionals[1]!);
    const data = await client.request<{ projectUpdate: { success: boolean; project: Record<string, unknown> } }>(`mutation SetProjectStatus($id: String!, $statusId: String!) { projectUpdate(id: $id, input: { statusId: $statusId }) { success project { ${PROJECT_LIST_SELECTION} } } }`, { id: project.id, statusId: status.id });
    const updated = mutationEntity(data.projectUpdate, "project") as Record<string, unknown>; return { result: "project status updated", project: compact({ id: updated.id, name: updated.name, status: (updated.status as { name?: string })?.name }) };
  }
  if (action === "create") {
    const definition: CommandDefinition = { usage: "linear-axi project status create --name <name> --color <hex> --type <type>", description: "Create a project status", flags: { "--name": { type: "string", required: true, description: "Status name" }, "--color": { type: "string", required: true, description: "Hex color" }, "--type": { type: "string", required: true, description: "backlog, planned, started, paused, completed, or canceled" }, "--description": { type: "string", description: "Status description" }, "--team": { type: "string", description: "Optional team" } } };
    const parsed = parseArgs(rest, definition); const type = parseProjectStatusType(stringFlag(parsed, "--type")!); const team = stringFlag(parsed, "--team");
    const input = compact({ name: stringFlag(parsed, "--name"), color: stringFlag(parsed, "--color"), type, description: stringFlag(parsed, "--description"), teamId: team ? (await resolveLookup(client, "team", team)).id : undefined });
    const data = await client.request<{ projectStatusCreate: { success: boolean; status: Record<string, unknown> } }>(`mutation CreateProjectStatus($input: ProjectStatusCreateInput!) { projectStatusCreate(input: $input) { success status { ${PROJECT_STATUS_SELECTION} } } }`, { input });
    return { result: "project status created", projectStatus: statusRecord(mutationEntity(data.projectStatusCreate, "status") as Record<string, unknown>) };
  }
  if (action === "update") {
    const definition: CommandDefinition = { usage: "linear-axi project status update <status>", description: "Update a project status", positionals: [{ name: "status", required: true }], flags: { "--name": { type: "string", description: "New name" }, "--color": { type: "string", description: "New color" }, "--type": { type: "string", description: "New type" }, "--description": { type: "string", description: "New description" } } };
    const parsed = parseArgs(rest, definition); const status = await resolveLookup(client, "project-status", parsed.positionals[0]!); const input = compact({ name: stringFlag(parsed, "--name"), color: stringFlag(parsed, "--color"), description: stringFlag(parsed, "--description"), type: stringFlag(parsed, "--type") ? parseProjectStatusType(stringFlag(parsed, "--type")!) : undefined });
    if (!Object.keys(input).length) throw new AxiError("No project status changes provided", "VALIDATION_ERROR");
    const data = await client.request<{ projectStatusUpdate: { success: boolean; status: Record<string, unknown> } }>(`mutation UpdateProjectStatus($id: String!, $input: ProjectStatusUpdateInput!) { projectStatusUpdate(id: $id, input: $input) { success status { ${PROJECT_STATUS_SELECTION} } } }`, { id: status.id, input });
    return { result: "project status updated", projectStatus: statusRecord(mutationEntity(data.projectStatusUpdate, "status") as Record<string, unknown>) };
  }
  if (action === "archive" || action === "unarchive") {
    const definition: CommandDefinition = { usage: `linear-axi project status ${action} <status>`, description: `${action} a project status`, positionals: [{ name: "status", required: true }] };
    const parsed = parseArgs(rest, definition); const status = await resolveLookup(client, "project-status", parsed.positionals[0]!); const mutation = action === "archive" ? "projectStatusArchive" : "projectStatusUnarchive";
    const data = await client.request<Record<string, { success: boolean; entity: Record<string, unknown> }>>(`mutation ArchiveProjectStatus($id: String!) { ${mutation}(id: $id) { success entity { ${PROJECT_STATUS_SELECTION} } } }`, { id: status.id });
    return { result: `project status ${action}d`, projectStatus: statusRecord(mutationEntity(data[mutation]!, "entity") as Record<string, unknown>) };
  }
  throw new AxiError(`Unknown project status action: ${action}`, "VALIDATION_ERROR");
}

async function milestoneCommand(args: string[], client: LinearClient): Promise<OutputRecord> {
  const action = args[0]; if (!action) throw new AxiError("Missing milestone action", "VALIDATION_ERROR", ["Use list, create, update, move, or delete"]); const rest = args.slice(1);
  if (action === "list") {
    const definition: CommandDefinition = { usage: "linear-axi project milestone list [project]", description: "List project milestones", positionals: [{ name: "project" }], flags: LIST_FLAGS };
    const parsed = parseArgs(rest, definition); const limit = boundedLimit(parsed); const project = parsed.positionals[0] ? await resolveLookup(client, "project", parsed.positionals[0]) : undefined; const filter = project ? { project: { id: { eq: project.id } } } : null;
    const data = await client.request<{ projectMilestones: Connection<Record<string, unknown>> }>(`query Milestones($first: Int!, $after: String, $includeArchived: Boolean!, $filter: ProjectMilestoneFilter) { projectMilestones(first: $first, after: $after, includeArchived: $includeArchived, filter: $filter) { nodes { ${MILESTONE_SELECTION} } pageInfo { hasNextPage endCursor } } }`, { first: limit, after: stringFlag(parsed, "--after") ?? null, includeArchived: booleanFlag(parsed, "--include-archived"), filter });
    await attachTotalCount(data.projectMilestones, async (after) => { const page = await client.request<{ projectMilestones: Connection<{ id: string }> }>("query MilestoneCount($after: String!, $includeArchived: Boolean!, $filter: ProjectMilestoneFilter) { projectMilestones(first: 250, after: $after, includeArchived: $includeArchived, filter: $filter) { nodes { id } pageInfo { hasNextPage endCursor } } }", { after, includeArchived: booleanFlag(parsed, "--include-archived"), filter }); return page.projectMilestones; }, { startsAtBeginning: stringFlag(parsed, "--after") === undefined });
    return listOutput("milestones", data.projectMilestones, data.projectMilestones.nodes.map(milestoneRecord), { limit, command: "linear-axi project milestone list" });
  }
  if (action === "create") {
    const definition: CommandDefinition = { usage: "linear-axi project milestone create <project> --name <name>", description: "Create a project milestone", positionals: [{ name: "project", required: true }], flags: { "--name": { type: "string", required: true, description: "Milestone name" }, "--description": { type: "string", description: "Description" }, "--target-date": { type: "string", description: "YYYY-MM-DD" } } };
    const parsed = parseArgs(rest, definition); const project = await resolveLookup(client, "project", parsed.positionals[0]!); const targetDate = stringFlag(parsed, "--target-date"); const input = compact({ projectId: project.id, name: stringFlag(parsed, "--name"), description: stringFlag(parsed, "--description"), targetDate: targetDate ? parseDate(targetDate) : undefined });
    const data = await client.request<{ projectMilestoneCreate: { success: boolean; projectMilestone: Record<string, unknown> } }>(`mutation MilestoneCreate($input: ProjectMilestoneCreateInput!) { projectMilestoneCreate(input: $input) { success projectMilestone { ${MILESTONE_SELECTION} } } }`, { input });
    return { result: "project milestone created", milestone: milestoneRecord(mutationEntity(data.projectMilestoneCreate, "projectMilestone") as Record<string, unknown>) };
  }
  if (action === "update") {
    const definition: CommandDefinition = { usage: "linear-axi project milestone update <milestone>", description: "Update a project milestone", positionals: [{ name: "milestone", required: true }], flags: { "--name": { type: "string", description: "New name" }, "--description": { type: "string", description: "New description" }, "--target-date": { type: "string", description: "YYYY-MM-DD or none" } } };
    const parsed = parseArgs(rest, definition); const milestone = await resolveLookup(client, "milestone", parsed.positionals[0]!); const targetDate = stringFlag(parsed, "--target-date"); const input = compact({ name: stringFlag(parsed, "--name"), description: stringFlag(parsed, "--description"), targetDate: targetDate ? (isNone(targetDate) ? null : parseDate(targetDate)) : undefined }); if (!Object.keys(input).length) throw new AxiError("No milestone changes provided", "VALIDATION_ERROR");
    const data = await client.request<{ projectMilestoneUpdate: { success: boolean; projectMilestone: Record<string, unknown> } }>(`mutation MilestoneUpdate($id: String!, $input: ProjectMilestoneUpdateInput!) { projectMilestoneUpdate(id: $id, input: $input) { success projectMilestone { ${MILESTONE_SELECTION} } } }`, { id: milestone.id, input });
    return { result: "project milestone updated", milestone: milestoneRecord(mutationEntity(data.projectMilestoneUpdate, "projectMilestone") as Record<string, unknown>) };
  }
  if (action === "move") {
    const definition: CommandDefinition = { usage: "linear-axi project milestone move <milestone> <project>", description: "Move a milestone to another project", positionals: [{ name: "milestone", required: true }, { name: "project", required: true }] };
    const parsed = parseArgs(rest, definition); const milestone = await resolveLookup(client, "milestone", parsed.positionals[0]!); const project = await resolveLookup(client, "project", parsed.positionals[1]!);
    const data = await client.request<{ projectMilestoneMove: { success: boolean; projectMilestone: Record<string, unknown> } }>(`mutation MilestoneMove($id: String!, $input: ProjectMilestoneMoveInput!) { projectMilestoneMove(id: $id, input: $input) { success projectMilestone { ${MILESTONE_SELECTION} } } }`, { id: milestone.id, input: { projectId: project.id } });
    return { result: "project milestone moved", milestone: milestoneRecord(mutationEntity(data.projectMilestoneMove, "projectMilestone") as Record<string, unknown>) };
  }
  if (action === "delete") {
    const definition: CommandDefinition = { usage: "linear-axi project milestone delete <milestone>", description: "Delete a project milestone", positionals: [{ name: "milestone", required: true }] };
    const parsed = parseArgs(rest, definition); const milestone = await resolveLookup(client, "milestone", parsed.positionals[0]!); const data = await client.request<{ projectMilestoneDelete: { success: boolean; entityId: string } }>("mutation MilestoneDelete($id: String!) { projectMilestoneDelete(id: $id) { success entityId } }", { id: milestone.id }); if (!data.projectMilestoneDelete.success) throw new AxiError("Linear did not delete the milestone", "API_ERROR"); return { result: "project milestone deleted", milestone: { id: data.projectMilestoneDelete.entityId, name: milestone.name } };
  }
  throw new AxiError(`Unknown milestone action: ${action}`, "VALIDATION_ERROR");
}

function projectRecord(raw: Record<string, unknown>, full = false): OutputRecord {
  const status = raw.status as { name?: string; type?: string } | null | undefined; const lead = raw.lead as { email?: string; name?: string } | null | undefined; const creator = raw.creator as { email?: string; name?: string } | null | undefined;
  const teams = raw.teams as { nodes?: Array<{ key?: string; name?: string }> } | undefined; const labels = raw.labels as { nodes?: Array<{ name?: string }> } | undefined; const milestones = raw.projectMilestones as { nodes?: Array<Record<string, unknown>> } | undefined; const issues = raw.issues as { nodes?: Array<Record<string, unknown>> } | undefined; const initiatives = raw.initiatives as { nodes?: Array<Record<string, unknown>> } | undefined; const documents = raw.documents as { nodes?: Array<Record<string, unknown>> } | undefined;
  return compact({ id: raw.id, slug: raw.slugId, name: raw.name, description: truncate(raw.description as string | undefined, full ? Number.MAX_SAFE_INTEGER : 1000).text, content: truncate(raw.content as string | undefined, full ? Number.MAX_SAFE_INTEGER : 1000).text, status: status?.name, statusType: status?.type, lead: lead?.email ?? lead?.name ?? "none", creator: creator?.email ?? creator?.name, teams: (teams?.nodes ?? []).map((team) => team.key ?? team.name), priority: raw.priority, startDate: raw.startDate, targetDate: raw.targetDate, labels: names(labels?.nodes), milestones: (milestones?.nodes ?? []).map(milestoneRecord), issues: (issues?.nodes ?? []).map((issue) => compact({ identifier: issue.identifier, title: issue.title, status: (issue.state as { name?: string } | undefined)?.name })), initiatives: (initiatives?.nodes ?? []).map((item) => compact({ name: item.name, status: item.status })), documents: (documents?.nodes ?? []).map((doc) => compact({ id: doc.id, title: doc.title, url: doc.url })), url: raw.url, createdAt: raw.createdAt, updatedAt: raw.updatedAt, completedAt: raw.completedAt, canceledAt: raw.canceledAt, archivedAt: raw.archivedAt, trashed: raw.trashed });
}

function statusRecord(raw: Record<string, unknown>): OutputRecord { const team = raw.team as { key?: string; name?: string } | null | undefined; return compact({ id: raw.id, name: raw.name, type: raw.type, color: raw.color, description: raw.description, team: team?.key ?? team?.name ?? "workspace", archivedAt: raw.archivedAt }); }
function milestoneRecord(raw: Record<string, unknown>): OutputRecord { const project = raw.project as { name?: string } | undefined; return compact({ id: raw.id, name: raw.name, description: raw.description, targetDate: raw.targetDate, status: raw.status, project: project?.name, sortOrder: raw.sortOrder }); }
function parseProjectStatusType(value: string): string { const valid = ["backlog", "planned", "started", "paused", "completed", "canceled"]; if (!valid.includes(value)) throw new AxiError(`Invalid project status type: ${value}`, "VALIDATION_ERROR", [`Valid types: ${valid.join(", ")}`]); return value; }
function parseDate(value: string): string { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new AxiError("Date must use YYYY-MM-DD", "VALIDATION_ERROR"); return value; }
function parseInteger(value: string, label: string): number { if (!/^-?\d+$/.test(value)) throw new AxiError(`${label} must be an integer or none`, "VALIDATION_ERROR"); return Number(value); }
function isNone(value: string): boolean { return ["none", "null"].includes(value.toLowerCase()); }
