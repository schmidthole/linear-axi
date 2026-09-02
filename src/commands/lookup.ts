import { AxiError } from "axi-sdk-js";
import { booleanFlag, boundedLimit, LIST_FLAGS, parseArgs, stringFlag, type CommandDefinition } from "../args.js";
import type { Connection, LinearClient } from "../client.js";
import { attachTotalCount } from "../client.js";
import { listOutput, type OutputRecord } from "../output.js";
import { resolveLookup } from "../resolve.js";

const LOOKUP_HELP = `usage: linear-axi lookup <type> [flags]
types[9]: teams, users, states, labels, project-labels, initiative-labels, project-statuses, milestones, priorities
flags:
  --team <team>       Narrow states or labels to a team
  --project <project> Narrow milestones to a project
  --include-archived  Include archived values
  --limit <n>         Maximum results (default 100, max 250)
  --after <cursor>    Continue a paginated response
examples:
  linear-axi lookup teams
  linear-axi lookup users
  linear-axi lookup states --team ENG
  linear-axi lookup labels --team ENG
  linear-axi lookup milestones --project "Q4 reliability"
`;

interface LookupListDefinition {
  connection: string;
  singular: "team" | "user" | "state" | "label" | "project-label" | "initiative-label" | "project-status" | "milestone";
  selection: string;
}

const TYPES: Record<string, LookupListDefinition> = {
  teams: { connection: "teams", singular: "team", selection: "id key name description color archivedAt" },
  users: { connection: "users", singular: "user", selection: "id name displayName email active admin" },
  states: { connection: "workflowStates", singular: "state", selection: "id name type color position team { id key name } archivedAt" },
  labels: { connection: "issueLabels", singular: "label", selection: "id name color description team { id key name } archivedAt" },
  "project-labels": { connection: "projectLabels", singular: "project-label", selection: "id name color description archivedAt" },
  "initiative-labels": { connection: "initiativeLabels", singular: "initiative-label", selection: "id name color description archivedAt" },
  "project-statuses": { connection: "projectStatuses", singular: "project-status", selection: "id name type color description team { id key name } archivedAt" },
  milestones: { connection: "projectMilestones", singular: "milestone", selection: "id name description targetDate status project { id name } archivedAt" },
};

export async function lookupCommand(args: string[], client: LinearClient): Promise<OutputRecord | string> {
  const type = args[0];
  if (!type || type === "--help") return LOOKUP_HELP;
  if (args.includes("--help")) return LOOKUP_HELP;
  if (type === "priorities") {
    if (args.length > 1) throw new AxiError("lookup priorities takes no flags", "VALIDATION_ERROR");
    return { count: 5, priorities: [{ value: 0, name: "no" }, { value: 1, name: "urgent" }, { value: 2, name: "high" }, { value: 3, name: "medium" }, { value: 4, name: "low" }] };
  }
  const lookup = TYPES[type];
  if (!lookup) throw new AxiError(`Unknown lookup type: ${type}`, "VALIDATION_ERROR", [`Valid types: ${[...Object.keys(TYPES), "priorities"].join(", ")}`]);
  const definition: CommandDefinition = {
    usage: `linear-axi lookup ${type}`,
    description: `List Linear ${type}`,
    flags: {
      ...LIST_FLAGS,
      "--team": { type: "string", description: "Narrow team-scoped values" },
      "--project": { type: "string", description: "Narrow project milestones" },
    },
  };
  const parsed = parseArgs(args.slice(1), definition);
  const limit = boundedLimit(parsed, 100);
  const team = stringFlag(parsed, "--team");
  const project = stringFlag(parsed, "--project");
  if (team && !["states", "labels", "project-statuses"].includes(type)) throw new AxiError(`--team is not valid for lookup ${type}`, "VALIDATION_ERROR");
  if (project && type !== "milestones") throw new AxiError(`--project is only valid for lookup milestones`, "VALIDATION_ERROR");
  const teamId = team ? (await resolveLookup(client, "team", team)).id : undefined;
  const projectId = project ? (await resolveLookup(client, "project", project)).id : undefined;
  const extra = type === "users" ? ", includeDisabled: true" : "";
  const data = await client.request<Record<string, Connection<Record<string, unknown>>>>(
    `query Lookup($first: Int!, $after: String, $includeArchived: Boolean!) {
      ${lookup.connection}(first: $first, after: $after, includeArchived: $includeArchived${extra}) {
        nodes { ${lookup.selection} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { first: limit, after: stringFlag(parsed, "--after") ?? null, includeArchived: booleanFlag(parsed, "--include-archived") },
  );
  const connection = data[lookup.connection];
  if (!connection) throw new AxiError(`Linear returned no ${type} lookup data`, "API_ERROR");
  let allNodes = [...connection.nodes];
  if ((teamId || projectId) && stringFlag(parsed, "--after") === undefined) {
    let pageInfo = connection.pageInfo;
    while (pageInfo.hasNextPage && pageInfo.endCursor) {
      const page = await client.request<Record<string, Connection<Record<string, unknown>>>>(
        `query LookupFilteredPage($after: String!, $includeArchived: Boolean!) { ${lookup.connection}(first: 250, after: $after, includeArchived: $includeArchived${extra}) { nodes { ${lookup.selection} } pageInfo { hasNextPage endCursor } } }`,
        { after: pageInfo.endCursor, includeArchived: booleanFlag(parsed, "--include-archived") },
      );
      const next = page[lookup.connection]!;
      allNodes.push(...next.nodes);
      pageInfo = next.pageInfo;
    }
  }
  let nodes = allNodes;
  if (teamId) nodes = nodes.filter((node) => (node.team as { id?: string } | null)?.id === teamId);
  if (projectId) nodes = nodes.filter((node) => (node.project as { id?: string } | null)?.id === projectId);
  if (!teamId && !projectId) await attachTotalCount(connection, async (after) => { const page = await client.request<Record<string, Connection<{ id: string }>>>(`query LookupCount($after: String!, $includeArchived: Boolean!) { ${lookup.connection}(first: 250, after: $after, includeArchived: $includeArchived${extra}) { nodes { id } pageInfo { hasNextPage endCursor } } }`, { after, includeArchived: booleanFlag(parsed, "--include-archived") }); return page[lookup.connection]!; }, { startsAtBeginning: stringFlag(parsed, "--after") === undefined });
  const totalCount = teamId || projectId ? nodes.length : connection.totalCount;
  const displayed = nodes.slice(0, limit);
  const items = displayed.map(lookupRecord);
  const filteredConnection: Connection<Record<string, unknown>> = {
    ...connection,
    nodes: displayed,
    ...(totalCount !== undefined ? { totalCount } : {}),
    ...(teamId || projectId ? { pageInfo: { hasNextPage: false, endCursor: null } } : {}),
  };
  const output = listOutput(type, filteredConnection, items, { limit, command: `linear-axi lookup ${type}` });
  if ((teamId || projectId) && nodes.length > limit) output.help = [`Run \`linear-axi lookup ${type} --limit ${Math.min(nodes.length, 250)}\` to show more matching values`];
  return output;
}

function lookupRecord(raw: Record<string, unknown>): OutputRecord {
  const team = raw.team as { key?: string; name?: string } | null | undefined;
  const project = raw.project as { name?: string } | null | undefined;
  return Object.fromEntries(Object.entries({
    id: raw.id,
    key: raw.key,
    name: raw.name ?? raw.displayName,
    email: raw.email,
    type: raw.type,
    color: raw.color,
    description: raw.description,
    active: raw.active,
    admin: raw.admin,
    team: team?.key ?? team?.name,
    project: project?.name,
    targetDate: raw.targetDate,
    status: raw.status,
    archivedAt: raw.archivedAt,
  }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}
