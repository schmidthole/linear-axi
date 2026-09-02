import { AxiError } from "axi-sdk-js";
import {
  booleanFlag, boundedLimit, commandHelp, LIST_FLAGS, parseArgs, stringFlag, stringsFlag, textInput,
  type CommandDefinition, type FlagDefinition, type ParsedArgs,
} from "../args.js";
import type { Connection, LinearClient } from "../client.js";
import { attachTotalCount, mutationEntity } from "../client.js";
import { INITIATIVE_DETAIL_SELECTION, INITIATIVE_LIST_SELECTION } from "../graphql.js";
import { compact, listOutput, names, selectFields, truncate, type OutputRecord } from "../output.js";
import { resolveLookup, resolveMany } from "../resolve.js";

const INITIATIVE_HELP = `usage: linear-axi initiative <subcommand> [args] [flags]
subcommands[10]:
  list, get <initiative>, create, update <initiative>, archive <initiative>,
  unarchive <initiative>, delete <initiative>, link-project <initiative> <project>,
  unlink-project <initiative> <project>, label <add|remove> <initiative> <label>
examples:
  linear-axi initiative list --status Active
  linear-axi initiative create --name "Platform reliability" --owner me
  linear-axi initiative link-project "Platform reliability" "Q4 reliability"
  linear-axi initiative update "Platform reliability" --status Completed
`;

const listAllowed = ["id", "slug", "name", "description", "status", "owner", "priority", "targetDate", "labels", "url", "updatedAt", "archivedAt", "trashed"];
const detailAllowed = [...listAllowed, "content", "creator", "projects", "documents", "createdAt", "completedAt", "canceledAt"];
const listFlags: Record<string, FlagDefinition> = {
  ...LIST_FLAGS,
  "--status": { type: "string", description: "Proposed, Planned, Active, Completed, or Canceled" },
  "--owner": { type: "string", description: "Owner user reference or none" },
  "--team": { type: "string", description: "Associated team reference" },
  "--priority": { type: "integer", description: "Numeric priority" },
};
const LIST_DEFINITION: CommandDefinition = { usage: "linear-axi initiative list", description: "List initiatives with exact filters", flags: listFlags };
const GET_DEFINITION: CommandDefinition = { usage: "linear-axi initiative get <initiative>", description: "Get an initiative by name, slug, or UUID", positionals: [{ name: "initiative", required: true }], flags: { "--full": { type: "boolean", description: "Do not truncate description or content" }, "--fields": { type: "string", description: "Comma-separated output fields" } } };
const CREATE_DEFINITION: CommandDefinition = {
  usage: "linear-axi initiative create", description: "Create an initiative",
  flags: {
    "--name": { type: "string", required: true, description: "Initiative name" },
    "--description": { type: "string", description: "Short description" },
    "--description-file": { type: "string", description: "Read short description from a file" },
    "--content": { type: "string", description: "Long-form Markdown content" },
    "--content-file": { type: "string", description: "Read long-form content from a file" },
    "--owner": { type: "string", description: "Owner user reference" },
    "--lead-team": { type: "string", description: "Lead team reference" },
    "--status": { type: "string", description: "Proposed, Planned, Active, Completed, or Canceled" },
    "--priority": { type: "integer", description: "Numeric priority" },
    "--target-date": { type: "string", description: "YYYY-MM-DD" },
    "--label": { type: "string", repeatable: true, description: "Initiative label name or ID" },
    "--icon": { type: "string", description: "Initiative icon" },
    "--color": { type: "string", description: "Hex color" },
  },
};
const UPDATE_DEFINITION: CommandDefinition = {
  usage: "linear-axi initiative update <initiative>", description: "Update initiative fields", positionals: [{ name: "initiative", required: true }],
  flags: {
    "--name": { type: "string", description: "New name" },
    "--description": { type: "string", description: "New short description" },
    "--description-file": { type: "string", description: "Read description from a file" },
    "--content": { type: "string", description: "New long-form Markdown" },
    "--content-file": { type: "string", description: "Read content from a file" },
    "--owner": { type: "string", description: "Owner user reference or none" },
    "--lead-team": { type: "string", description: "Lead team reference or none" },
    "--status": { type: "string", description: "Proposed, Planned, Active, Completed, or Canceled" },
    "--priority": { type: "string", description: "Numeric priority or none" },
    "--target-date": { type: "string", description: "YYYY-MM-DD or none" },
    "--label": { type: "string", repeatable: true, description: "Replace all initiative labels (use none to clear)" },
    "--icon": { type: "string", description: "New icon" },
    "--color": { type: "string", description: "New color" },
  },
};

export async function initiativeCommand(args: string[], client: LinearClient): Promise<OutputRecord | string> {
  const subcommand = args[0]; if (!subcommand || subcommand === "--help") return INITIATIVE_HELP; const rest = args.slice(1);
  if (rest.includes("--help")) {
    if (subcommand === "list") return commandHelp(LIST_DEFINITION); if (subcommand === "get") return commandHelp(GET_DEFINITION); if (subcommand === "create") return commandHelp(CREATE_DEFINITION); if (subcommand === "update") return commandHelp(UPDATE_DEFINITION);
    return `usage: linear-axi initiative ${subcommand} <initiative>${subcommand.includes("project") ? " <project>" : ""}\n`;
  }
  switch (subcommand) {
    case "list": return listInitiatives(rest, client);
    case "get": return getInitiative(rest, client);
    case "create": return createInitiative(rest, client);
    case "update": return updateInitiative(rest, client);
    case "archive": return archiveInitiative(rest, client, false);
    case "unarchive": return archiveInitiative(rest, client, true);
    case "delete": return deleteInitiative(rest, client);
    case "link-project": return initiativeProject(rest, client, true);
    case "unlink-project": return initiativeProject(rest, client, false);
    case "label": return labelInitiative(rest, client);
    default: throw new AxiError(`Unknown initiative subcommand: ${subcommand}`, "VALIDATION_ERROR", ["Run `linear-axi initiative --help`"]);
  }
}

async function listInitiatives(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, LIST_DEFINITION); const limit = boundedLimit(parsed); const filter: Record<string, unknown> = {};
  const status = stringFlag(parsed, "--status"); if (status) filter.status = { eq: parseStatus(status) };
  const owner = stringFlag(parsed, "--owner"); if (owner) filter.owner = isNone(owner) ? { null: true } : { id: { eq: (await resolveLookup(client, "user", owner)).id } };
  const team = stringFlag(parsed, "--team"); if (team) filter.teams = { some: { id: { eq: (await resolveLookup(client, "team", team)).id } } };
  const priority = parsed.flags["--priority"]; if (typeof priority === "number") filter.priority = { eq: priority };
  const data = await client.request<{ initiatives: Connection<Record<string, unknown>> }>(
    `query Initiatives($first: Int!, $after: String, $includeArchived: Boolean!, $filter: InitiativeFilter) { initiatives(first: $first, after: $after, includeArchived: $includeArchived, filter: $filter) { nodes { ${INITIATIVE_LIST_SELECTION} } pageInfo { hasNextPage endCursor } } }`,
    { first: limit, after: stringFlag(parsed, "--after") ?? null, includeArchived: booleanFlag(parsed, "--include-archived"), filter: Object.keys(filter).length ? filter : null },
  );
  await attachTotalCount(data.initiatives, async (after) => { const page = await client.request<{ initiatives: Connection<{ id: string }> }>("query InitiativeCount($after: String!, $includeArchived: Boolean!, $filter: InitiativeFilter) { initiatives(first: 250, after: $after, includeArchived: $includeArchived, filter: $filter) { nodes { id } pageInfo { hasNextPage endCursor } } }", { after, includeArchived: booleanFlag(parsed, "--include-archived"), filter: Object.keys(filter).length ? filter : null }); return page.initiatives; }, { startsAtBeginning: stringFlag(parsed, "--after") === undefined });
  const requested = stringFlag(parsed, "--fields"); const items = data.initiatives.nodes.map((node) => selectFields(initiativeRecord(node), requested, ["id", "name", "status", "owner"], listAllowed));
  return listOutput("initiatives", data.initiatives, items, { limit, command: "linear-axi initiative list" });
}

async function getInitiative(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, GET_DEFINITION); const initiative = await resolveLookup(client, "initiative", parsed.positionals[0]!);
  const data = await client.request<{ initiative: Record<string, unknown> | null }>(`query InitiativeGet($id: String!) { initiative(id: $id) { ${INITIATIVE_DETAIL_SELECTION} } }`, { id: initiative.id });
  if (!data.initiative) throw new AxiError(`Initiative not found: ${parsed.positionals[0]}`, "NOT_FOUND"); const full = booleanFlag(parsed, "--full"); const item = initiativeRecord(data.initiative, full);
  const defaults = ["id", "slug", "name", "description", "content", "status", "owner", "priority", "targetDate", "labels", "projects", "documents", "url", "updatedAt"];
  const output: OutputRecord = { initiative: selectFields(item, stringFlag(parsed, "--fields"), defaults, detailAllowed) }; if (!full && ([data.initiative.description, data.initiative.content] as unknown[]).some((value) => typeof value === "string" && value.length > 1000)) output.help = [`Run \`linear-axi initiative get ${parsed.positionals[0]} --full\` for complete content`]; return output;
}

async function createInitiative(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, CREATE_DEFINITION); const input: Record<string, unknown> = { name: stringFlag(parsed, "--name") }; await populateInitiativeInput(input, parsed, client, true);
  const data = await client.request<{ initiativeCreate: { success: boolean; initiative: Record<string, unknown> } }>(`mutation InitiativeCreate($input: InitiativeCreateInput!) { initiativeCreate(input: $input) { success initiative { ${INITIATIVE_LIST_SELECTION} } } }`, { input });
  const initiative = mutationEntity(data.initiativeCreate, "initiative") as Record<string, unknown>; return { result: "initiative created", initiative: selectFields(initiativeRecord(initiative), undefined, ["id", "name", "status", "owner", "url"], listAllowed) };
}

async function updateInitiative(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, UPDATE_DEFINITION); const initiative = await resolveLookup(client, "initiative", parsed.positionals[0]!); const input: Record<string, unknown> = {}; await populateInitiativeInput(input, parsed, client, false); if (!Object.keys(input).length) throw new AxiError("No initiative changes provided", "VALIDATION_ERROR", ["Run `linear-axi initiative update --help`"]);
  const data = await client.request<{ initiativeUpdate: { success: boolean; initiative: Record<string, unknown> } }>(`mutation InitiativeUpdate($id: String!, $input: InitiativeUpdateInput!) { initiativeUpdate(id: $id, input: $input) { success initiative { ${INITIATIVE_LIST_SELECTION} } } }`, { id: initiative.id, input });
  const updated = mutationEntity(data.initiativeUpdate, "initiative") as Record<string, unknown>; return { result: "initiative updated", initiative: selectFields(initiativeRecord(updated), undefined, ["id", "name", "status", "owner", "priority", "targetDate", "labels"], listAllowed) };
}

async function populateInitiativeInput(input: Record<string, unknown>, parsed: ParsedArgs, client: LinearClient, creating: boolean): Promise<void> {
  for (const [flag, key] of [["--name", "name"], ["--icon", "icon"], ["--color", "color"]] as const) { const value = stringFlag(parsed, flag); if (value !== undefined) input[key] = value; }
  const description = await textInput(parsed, "--description", "--description-file"); if (description !== undefined) input.description = description; const content = await textInput(parsed, "--content", "--content-file"); if (content !== undefined) input.content = content;
  const owner = stringFlag(parsed, "--owner"); if (owner) input.ownerId = !creating && isNone(owner) ? null : (await resolveLookup(client, "user", owner)).id; const leadTeam = stringFlag(parsed, "--lead-team"); if (leadTeam) input.leadTeamId = !creating && isNone(leadTeam) ? null : (await resolveLookup(client, "team", leadTeam)).id;
  const status = stringFlag(parsed, "--status"); if (status) input.status = parseStatus(status); const rawPriority = parsed.flags["--priority"]; if (typeof rawPriority === "number") input.priority = rawPriority; if (typeof rawPriority === "string") input.priority = isNone(rawPriority) ? null : parseInteger(rawPriority, "priority");
  const targetDate = stringFlag(parsed, "--target-date"); if (targetDate) input.targetDate = !creating && isNone(targetDate) ? null : parseDate(targetDate); const labels = stringsFlag(parsed, "--label"); if (labels.length) input.labelIds = !creating && labels.length === 1 && isNone(labels[0]!) ? [] : await resolveMany(client, "initiative-label", labels);
}

async function archiveInitiative(args: string[], client: LinearClient, unarchive: boolean): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: `linear-axi initiative ${unarchive ? "unarchive" : "archive"} <initiative>`, description: `${unarchive ? "Restore" : "Archive"} an initiative`, positionals: [{ name: "initiative", required: true }] }; const parsed = parseArgs(args, definition); const initiative = await resolveLookup(client, "initiative", parsed.positionals[0]!); const mutation = unarchive ? "initiativeUnarchive" : "initiativeArchive";
  const data = await client.request<Record<string, { success: boolean; entity: Record<string, unknown> }>>(`mutation InitiativeArchive($id: String!) { ${mutation}(id: $id) { success entity { ${INITIATIVE_LIST_SELECTION} } } }`, { id: initiative.id }); const entity = mutationEntity(data[mutation]!, "entity") as Record<string, unknown>; return { result: `initiative ${unarchive ? "unarchived" : "archived"}`, initiative: selectFields(initiativeRecord(entity), undefined, ["id", "name", "archivedAt"], listAllowed) };
}

async function deleteInitiative(args: string[], client: LinearClient): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: "linear-axi initiative delete <initiative>", description: "Delete an initiative", positionals: [{ name: "initiative", required: true }] }; const parsed = parseArgs(args, definition); const initiative = await resolveLookup(client, "initiative", parsed.positionals[0]!); const data = await client.request<{ initiativeDelete: { success: boolean; entityId: string } }>("mutation InitiativeDelete($id: String!) { initiativeDelete(id: $id) { success entityId } }", { id: initiative.id }); if (!data.initiativeDelete.success) throw new AxiError("Linear did not delete the initiative", "API_ERROR"); return { result: "initiative deleted", initiative: compact({ id: data.initiativeDelete.entityId, name: initiative.name }) };
}

async function initiativeProject(args: string[], client: LinearClient, link: boolean): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: `linear-axi initiative ${link ? "link" : "unlink"}-project <initiative> <project>`, description: `${link ? "Link" : "Unlink"} a project ${link ? "to" : "from"} an initiative`, positionals: [{ name: "initiative", required: true }, { name: "project", required: true }] }; const parsed = parseArgs(args, definition); const initiative = await resolveLookup(client, "initiative", parsed.positionals[0]!); const project = await resolveLookup(client, "project", parsed.positionals[1]!);
  if (link) {
    const data = await client.request<{ initiativeToProjectCreate: { success: boolean; initiativeToProject: Record<string, unknown> } }>("mutation LinkProject($input: InitiativeToProjectCreateInput!) { initiativeToProjectCreate(input: $input) { success initiativeToProject { id sortOrder initiative { id name } project { id name } } } }", { input: { initiativeId: initiative.id, projectId: project.id } }); const relation = mutationEntity(data.initiativeToProjectCreate, "initiativeToProject") as Record<string, unknown>; return { result: "project linked to initiative", link: initiativeProjectRecord(relation) };
  }
  const relation = await findInitiativeProject(client, initiative.id, project.id); if (!relation) return { result: "project already unlinked from initiative", link: { initiative: initiative.name, project: project.name } };
  const data = await client.request<{ initiativeToProjectDelete: { success: boolean; entityId: string } }>("mutation UnlinkProject($id: String!) { initiativeToProjectDelete(id: $id) { success entityId } }", { id: relation.id }); if (!data.initiativeToProjectDelete.success) throw new AxiError("Linear did not unlink the project", "API_ERROR"); return { result: "project unlinked from initiative", link: { id: data.initiativeToProjectDelete.entityId, initiative: initiative.name, project: project.name } };
}

async function findInitiativeProject(client: LinearClient, initiativeId: string, projectId: string): Promise<Record<string, unknown> | undefined> {
  let after: string | null = null; do { const data: { initiativeToProjects: Connection<Record<string, unknown>> } = await client.request<{ initiativeToProjects: Connection<Record<string, unknown>> }>("query InitiativeProjectLinks($after: String) { initiativeToProjects(first: 250, after: $after, includeArchived: true) { nodes { id initiative { id } project { id } } pageInfo { hasNextPage endCursor } } }", { after }); const found = data.initiativeToProjects.nodes.find((node: Record<string, unknown>) => (node.initiative as { id?: string })?.id === initiativeId && (node.project as { id?: string })?.id === projectId); if (found) return found; after = data.initiativeToProjects.pageInfo.hasNextPage ? (data.initiativeToProjects.pageInfo.endCursor ?? null) : null; } while (after); return undefined;
}

async function labelInitiative(args: string[], client: LinearClient): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: "linear-axi initiative label <add|remove> <initiative> <label>", description: "Add or remove an initiative label", positionals: [{ name: "action", required: true }, { name: "initiative", required: true }, { name: "label", required: true }] }; const parsed = parseArgs(args, definition); const [action, initiativeRef, labelRef] = parsed.positionals; if (action !== "add" && action !== "remove") throw new AxiError("Label action must be add or remove", "VALIDATION_ERROR"); const initiative = await resolveLookup(client, "initiative", initiativeRef!); const label = await resolveLookup(client, "initiative-label", labelRef!); const mutation = action === "add" ? "initiativeAddLabel" : "initiativeRemoveLabel";
  const data = await client.request<Record<string, { success: boolean; initiative: Record<string, unknown> }>>(`mutation InitiativeLabel($id: String!, $labelId: String!) { ${mutation}(id: $id, labelId: $labelId) { success initiative { ${INITIATIVE_LIST_SELECTION} } } }`, { id: initiative.id, labelId: label.id }); const updated = mutationEntity(data[mutation]!, "initiative") as Record<string, unknown>; return { result: `initiative label ${action === "add" ? "added" : "removed"}`, initiative: selectFields(initiativeRecord(updated), undefined, ["id", "name", "labels"], listAllowed) };
}

function initiativeRecord(raw: Record<string, unknown>, full = false): OutputRecord { const owner = raw.owner as { email?: string; name?: string } | null | undefined; const creator = raw.creator as { email?: string; name?: string } | null | undefined; const labels = raw.labels as { nodes?: Array<{ name?: string }> } | undefined; const projects = raw.projects as { nodes?: Array<Record<string, unknown>> } | undefined; const documents = raw.documents as { nodes?: Array<Record<string, unknown>> } | undefined; return compact({ id: raw.id, slug: raw.slugId, name: raw.name, description: truncate(raw.description as string | undefined, full ? Number.MAX_SAFE_INTEGER : 1000).text, content: truncate(raw.content as string | undefined, full ? Number.MAX_SAFE_INTEGER : 1000).text, status: raw.status, owner: owner?.email ?? owner?.name ?? "none", creator: creator?.email ?? creator?.name, priority: raw.priority, targetDate: raw.targetDate, labels: names(labels?.nodes), projects: (projects?.nodes ?? []).map((project) => compact({ name: project.name, status: (project.status as { name?: string } | undefined)?.name })), documents: (documents?.nodes ?? []).map((document) => compact({ id: document.id, title: document.title, url: document.url })), url: raw.url, createdAt: raw.createdAt, updatedAt: raw.updatedAt, completedAt: raw.completedAt, canceledAt: raw.canceledAt, archivedAt: raw.archivedAt, trashed: raw.trashed }); }
function initiativeProjectRecord(raw: Record<string, unknown>): OutputRecord { const initiative = raw.initiative as { identifier?: string; name?: string } | undefined; const project = raw.project as { identifier?: string; name?: string } | undefined; return compact({ id: raw.id, initiative: initiative?.identifier ?? initiative?.name, project: project?.identifier ?? project?.name, sortOrder: raw.sortOrder }); }
function parseStatus(value: string): string { const values: Record<string, string> = { proposed: "Proposed", planned: "Planned", active: "Active", completed: "Completed", canceled: "Canceled", cancelled: "Canceled" }; const status = values[value.toLowerCase()]; if (!status) throw new AxiError(`Invalid initiative status: ${value}`, "VALIDATION_ERROR", ["Use Proposed, Planned, Active, Completed, or Canceled"]); return status; }
function parseDate(value: string): string { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new AxiError("Date must use YYYY-MM-DD", "VALIDATION_ERROR"); return value; }
function parseInteger(value: string, label: string): number { if (!/^-?\d+$/.test(value)) throw new AxiError(`${label} must be an integer or none`, "VALIDATION_ERROR"); return Number(value); }
function isNone(value: string): boolean { return ["none", "null"].includes(value.toLowerCase()); }
