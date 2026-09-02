import { AxiError } from "axi-sdk-js";
import {
  booleanFlag, boundedLimit, commandHelp, LIST_FLAGS, parseArgs, stringFlag, textInput,
  type CommandDefinition, type FlagDefinition, type ParsedArgs,
} from "../args.js";
import type { Connection, LinearClient } from "../client.js";
import { attachTotalCount, mutationEntity } from "../client.js";
import { DOCUMENT_DETAIL_SELECTION, DOCUMENT_LIST_SELECTION } from "../graphql.js";
import { compact, listOutput, selectFields, truncate, type OutputRecord } from "../output.js";
import { resolveIssue, resolveLookup } from "../resolve.js";

const DOCUMENT_HELP = `usage: linear-axi document <subcommand> [args] [flags]
subcommands[6]: list, search <query>, get <document>, create, update <document>, delete <document>
examples:
  linear-axi document list --project "Q4 reliability"
  linear-axi document search "launch plan"
  linear-axi document create --title "Launch plan" --project "Q4 reliability" --content-file plan.md
  linear-axi document update <id> --title "Launch plan v2"
`;
const listAllowed = ["id", "title", "owner", "project", "initiative", "team", "issue", "url", "updatedAt", "archivedAt", "trashed"];
const detailAllowed = [...listAllowed, "content", "creator", "comments", "createdAt"];
const listFlags: Record<string, FlagDefinition> = {
  ...LIST_FLAGS,
  "--project": { type: "string", description: "Project reference" },
  "--initiative": { type: "string", description: "Initiative reference" },
  "--team": { type: "string", description: "Team reference" },
  "--issue": { type: "string", description: "Issue identifier or ID" },
  "--owner": { type: "string", description: "Owner user reference or none" },
};
const LIST_DEFINITION: CommandDefinition = { usage: "linear-axi document list", description: "List Linear documents", flags: listFlags };
const SEARCH_DEFINITION: CommandDefinition = { ...LIST_DEFINITION, usage: "linear-axi document search <query>", description: "Full-text search Linear documents", positionals: [{ name: "query", required: true }] };
const GET_DEFINITION: CommandDefinition = { usage: "linear-axi document get <document>", description: "Get a document by title, slug, or UUID", positionals: [{ name: "document", required: true }], flags: { "--full": { type: "boolean", description: "Do not truncate content or comments" }, "--fields": { type: "string", description: "Comma-separated output fields" } } };
const CREATE_DEFINITION: CommandDefinition = {
  usage: "linear-axi document create", description: "Create a Linear document",
  flags: {
    "--title": { type: "string", required: true, description: "Document title" },
    "--content": { type: "string", description: "Markdown content" },
    "--content-file": { type: "string", description: "Read Markdown content from a file" },
    "--project": { type: "string", description: "Attach to a project" },
    "--initiative": { type: "string", description: "Attach to an initiative" },
    "--team": { type: "string", description: "Attach to a team" },
    "--issue": { type: "string", description: "Attach to an issue" },
    "--owner": { type: "string", description: "Owner user reference" },
    "--icon": { type: "string", description: "Document icon" },
    "--color": { type: "string", description: "Hex color" },
  },
};
const UPDATE_DEFINITION: CommandDefinition = {
  usage: "linear-axi document update <document>", description: "Update a Linear document", positionals: [{ name: "document", required: true }],
  flags: {
    "--title": { type: "string", description: "New title" },
    "--content": { type: "string", description: "New Markdown content" },
    "--content-file": { type: "string", description: "Read new content from a file" },
    "--project": { type: "string", description: "Project reference or none" },
    "--initiative": { type: "string", description: "Initiative reference or none" },
    "--team": { type: "string", description: "Team reference or none" },
    "--issue": { type: "string", description: "Issue reference or none" },
    "--owner": { type: "string", description: "Owner user reference or none" },
    "--icon": { type: "string", description: "New icon" },
    "--color": { type: "string", description: "New color" },
  },
};

export async function documentCommand(args: string[], client: LinearClient): Promise<OutputRecord | string> {
  const subcommand = args[0]; if (!subcommand || subcommand === "--help") return DOCUMENT_HELP; const rest = args.slice(1);
  if (rest.includes("--help")) { if (subcommand === "list") return commandHelp(LIST_DEFINITION); if (subcommand === "search") return commandHelp(SEARCH_DEFINITION); if (subcommand === "get") return commandHelp(GET_DEFINITION); if (subcommand === "create") return commandHelp(CREATE_DEFINITION); if (subcommand === "update") return commandHelp(UPDATE_DEFINITION); return `usage: linear-axi document ${subcommand} <document>\n`; }
  switch (subcommand) {
    case "list": return listDocuments(rest, client, false);
    case "search": return listDocuments(rest, client, true);
    case "get": return getDocument(rest, client);
    case "create": return createDocument(rest, client);
    case "update": return updateDocument(rest, client);
    case "delete": return deleteDocument(rest, client);
    default: throw new AxiError(`Unknown document subcommand: ${subcommand}`, "VALIDATION_ERROR", ["Run `linear-axi document --help`"]);
  }
}

async function listDocuments(args: string[], client: LinearClient, search: boolean): Promise<OutputRecord> {
  const parsed = parseArgs(args, search ? SEARCH_DEFINITION : LIST_DEFINITION); const limit = boundedLimit(parsed); const filter = await documentFilter(parsed, client); const queryName = search ? "searchDocuments" : "documents";
  const data = await client.request<Record<string, Connection<Record<string, unknown>>>>(
    `query Documents($first: Int!, $after: String, $includeArchived: Boolean!${search ? ", $term: String!" : ", $filter: DocumentFilter"}) { ${queryName}(first: $first, after: $after, includeArchived: $includeArchived${search ? ", term: $term" : ", filter: $filter"}) { nodes { ${DOCUMENT_LIST_SELECTION} } pageInfo { hasNextPage endCursor } } }`,
    { first: limit, after: stringFlag(parsed, "--after") ?? null, includeArchived: booleanFlag(parsed, "--include-archived"), filter: Object.keys(filter).length ? filter : null, ...(search ? { term: parsed.positionals[0] } : {}) },
  );
  const connection = data[queryName]; if (!connection) throw new AxiError("Linear returned no document list data", "API_ERROR"); let nodes = connection.nodes;
  if (!search || Object.keys(filter).length === 0) await attachTotalCount(connection, async (after) => { const page = await client.request<Record<string, Connection<{ id: string }>>>(`query DocumentCount($after: String!, $includeArchived: Boolean!${search ? ", $term: String!" : ", $filter: DocumentFilter"}) { ${queryName}(first: 250, after: $after, includeArchived: $includeArchived${search ? ", term: $term" : ", filter: $filter"}) { nodes { id } pageInfo { hasNextPage endCursor } } }`, { after, includeArchived: booleanFlag(parsed, "--include-archived"), ...(search ? { term: parsed.positionals[0] } : { filter: Object.keys(filter).length ? filter : null }) }); return page[queryName]!; }, { startsAtBeginning: stringFlag(parsed, "--after") === undefined });
  const initialAfter = stringFlag(parsed, "--after");
  if (search && Object.keys(filter).length) {
    let allNodes = [...nodes];
    if (initialAfter === undefined) {
      let pageInfo = connection.pageInfo;
      while (pageInfo.hasNextPage && pageInfo.endCursor) {
        const page = await client.request<{ searchDocuments: Connection<Record<string, unknown>> }>(`query DocumentSearchFiltered($after: String!, $includeArchived: Boolean!, $term: String!) { searchDocuments(first: 250, after: $after, includeArchived: $includeArchived, term: $term) { nodes { ${DOCUMENT_LIST_SELECTION} } pageInfo { hasNextPage endCursor } } }`, { after: pageInfo.endCursor, includeArchived: booleanFlag(parsed, "--include-archived"), term: parsed.positionals[0] });
        allNodes.push(...page.searchDocuments.nodes);
        pageInfo = page.searchDocuments.pageInfo;
      }
    }
    nodes = allNodes.filter((node) => matchesDocumentFilter(node, filter));
  }
  const displayed = nodes.slice(0, limit); const requested = stringFlag(parsed, "--fields"); const items = displayed.map((node) => selectFields(documentRecord(node), requested, ["id", "title", "project", "updatedAt"], listAllowed));
  const resultConnection: Connection<Record<string, unknown>> = search && Object.keys(filter).length > 0 && initialAfter === undefined
    ? { nodes: displayed, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null } }
    : { ...connection, nodes: displayed };
  return listOutput("documents", resultConnection, items, { limit, command: search ? `linear-axi document search "${parsed.positionals[0]}"` : "linear-axi document list" });
}

async function documentFilter(parsed: ParsedArgs, client: LinearClient): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {}; const project = stringFlag(parsed, "--project"); if (project) filter.project = { id: { eq: (await resolveLookup(client, "project", project)).id } }; const initiative = stringFlag(parsed, "--initiative"); if (initiative) filter.initiative = { id: { eq: (await resolveLookup(client, "initiative", initiative)).id } }; const team = stringFlag(parsed, "--team"); if (team) filter.team = { id: { eq: (await resolveLookup(client, "team", team)).id } }; const issue = stringFlag(parsed, "--issue"); if (issue) filter.issue = { id: { eq: (await resolveIssue(client, issue)).id } }; const owner = stringFlag(parsed, "--owner"); if (owner) filter.owner = isNone(owner) ? { null: true } : { id: { eq: (await resolveLookup(client, "user", owner)).id } }; return filter;
}

function matchesDocumentFilter(node: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const key of ["project", "initiative", "team", "issue"] as const) {
    const expected = ((filter[key] as { id?: { eq?: string } } | undefined)?.id?.eq);
    const actual = node[key] as { id?: string } | null | undefined;
    if (expected && actual?.id !== expected) return false;
  }
  const ownerFilter = filter.owner as { id?: { eq?: string }; null?: boolean } | undefined;
  const owner = node.owner as { id?: string } | null | undefined;
  return (!ownerFilter?.null || !owner) && (!ownerFilter?.id?.eq || owner?.id === ownerFilter.id.eq);
}

async function getDocument(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, GET_DEFINITION); const document = await resolveLookup(client, "document", parsed.positionals[0]!); const data = await client.request<{ document: Record<string, unknown> | null }>(`query DocumentGet($id: String!) { document(id: $id) { ${DOCUMENT_DETAIL_SELECTION} } }`, { id: document.id }); if (!data.document) throw new AxiError(`Document not found: ${parsed.positionals[0]}`, "NOT_FOUND"); const full = booleanFlag(parsed, "--full"); const item = documentRecord(data.document, full); const defaults = ["id", "title", "content", "owner", "project", "initiative", "team", "issue", "comments", "url", "updatedAt"]; const output: OutputRecord = { document: selectFields(item, stringFlag(parsed, "--fields"), defaults, detailAllowed) }; if (!full && typeof data.document.content === "string" && data.document.content.length > 1500) output.help = [`Run \`linear-axi document get ${parsed.positionals[0]} --full\` for complete content`]; return output;
}

async function createDocument(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, CREATE_DEFINITION); const input: Record<string, unknown> = { title: stringFlag(parsed, "--title") }; await populateDocumentInput(input, parsed, client, true); const data = await client.request<{ documentCreate: { success: boolean; document: Record<string, unknown> } }>(`mutation DocumentCreate($input: DocumentCreateInput!) { documentCreate(input: $input) { success document { ${DOCUMENT_LIST_SELECTION} } } }`, { input }); const document = mutationEntity(data.documentCreate, "document") as Record<string, unknown>; return { result: "document created", document: selectFields(documentRecord(document), undefined, ["id", "title", "project", "initiative", "team", "issue", "url"], listAllowed) };
}

async function updateDocument(args: string[], client: LinearClient): Promise<OutputRecord> {
  const parsed = parseArgs(args, UPDATE_DEFINITION); const document = await resolveLookup(client, "document", parsed.positionals[0]!); const input: Record<string, unknown> = {}; await populateDocumentInput(input, parsed, client, false); if (!Object.keys(input).length) throw new AxiError("No document changes provided", "VALIDATION_ERROR", ["Run `linear-axi document update --help`"]); const data = await client.request<{ documentUpdate: { success: boolean; document: Record<string, unknown> } }>(`mutation DocumentUpdate($id: String!, $input: DocumentUpdateInput!) { documentUpdate(id: $id, input: $input) { success document { ${DOCUMENT_LIST_SELECTION} } } }`, { id: document.id, input }); const updated = mutationEntity(data.documentUpdate, "document") as Record<string, unknown>; return { result: "document updated", document: selectFields(documentRecord(updated), undefined, ["id", "title", "owner", "project", "initiative", "team", "issue", "url"], listAllowed) };
}

async function populateDocumentInput(input: Record<string, unknown>, parsed: ParsedArgs, client: LinearClient, creating: boolean): Promise<void> {
  for (const [flag, key] of [["--title", "title"], ["--icon", "icon"], ["--color", "color"]] as const) { const value = stringFlag(parsed, flag); if (value !== undefined) input[key] = value; } const content = await textInput(parsed, "--content", "--content-file"); if (content !== undefined) input.content = content;
  const project = stringFlag(parsed, "--project"); if (project) input.projectId = !creating && isNone(project) ? null : (await resolveLookup(client, "project", project)).id; const initiative = stringFlag(parsed, "--initiative"); if (initiative) input.initiativeId = !creating && isNone(initiative) ? null : (await resolveLookup(client, "initiative", initiative)).id; const team = stringFlag(parsed, "--team"); if (team) input.teamId = !creating && isNone(team) ? null : (await resolveLookup(client, "team", team)).id; const issue = stringFlag(parsed, "--issue"); if (issue) input.issueId = !creating && isNone(issue) ? null : (await resolveIssue(client, issue)).id; const owner = stringFlag(parsed, "--owner"); if (owner) input.ownerId = !creating && isNone(owner) ? null : (await resolveLookup(client, "user", owner)).id;
}

async function deleteDocument(args: string[], client: LinearClient): Promise<OutputRecord> {
  const definition: CommandDefinition = { usage: "linear-axi document delete <document>", description: "Delete (archive) a Linear document", positionals: [{ name: "document", required: true }] }; const parsed = parseArgs(args, definition); const document = await resolveLookup(client, "document", parsed.positionals[0]!); const data = await client.request<{ documentDelete: { success: boolean; entity: Record<string, unknown> } }>("mutation DocumentDelete($id: String!) { documentDelete(id: $id) { success entity { id title archivedAt url } } }", { id: document.id }); const entity = mutationEntity(data.documentDelete, "entity") as Record<string, unknown>; return { result: "document deleted", document: compact(entity) };
}

function documentRecord(raw: Record<string, unknown>, full = false): OutputRecord { const creator = raw.creator as { email?: string; name?: string } | null | undefined; const owner = raw.owner as { email?: string; name?: string } | null | undefined; const project = raw.project as { name?: string } | null | undefined; const initiative = raw.initiative as { name?: string } | null | undefined; const team = raw.team as { key?: string; name?: string } | null | undefined; const issue = raw.issue as { identifier?: string; title?: string } | null | undefined; const comments = raw.comments as { nodes?: Array<Record<string, unknown>> } | undefined; return compact({ id: raw.id, title: raw.title, content: truncate(raw.content as string | undefined, full ? Number.MAX_SAFE_INTEGER : 1500).text, creator: creator?.email ?? creator?.name, owner: owner?.email ?? owner?.name ?? "none", project: project?.name ?? "none", initiative: initiative?.name ?? "none", team: team?.key ?? team?.name ?? "none", issue: issue?.identifier ?? "none", comments: (comments?.nodes ?? []).map((comment) => { const user = comment.user as { email?: string; name?: string } | undefined; return compact({ id: comment.id, author: user?.email ?? user?.name, body: truncate(comment.body as string | undefined, full ? Number.MAX_SAFE_INTEGER : 800).text, createdAt: comment.createdAt }); }), url: raw.url, createdAt: raw.createdAt, updatedAt: raw.updatedAt, archivedAt: raw.archivedAt, trashed: raw.trashed }); }
function isNone(value: string): boolean { return ["none", "null"].includes(value.toLowerCase()); }
