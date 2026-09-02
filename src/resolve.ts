import { AxiError } from "axi-sdk-js";
import type { Connection, LinearClient } from "./client.js";
import type { LinearNode } from "./graphql.js";

interface LookupDefinition {
  noun: string;
  connection: string;
  selection: string;
  extraArguments?: string;
  variables?: Record<string, unknown>;
  matchKeys: Array<keyof LinearNode>;
}

const LOOKUPS: Record<string, LookupDefinition> = {
  team: {
    noun: "team",
    connection: "teams",
    selection: "id key name",
    matchKeys: ["key", "name"],
  },
  user: {
    noun: "user",
    connection: "users",
    selection: "id name displayName email active",
    extraArguments: ", includeDisabled: true",
    matchKeys: ["email", "name", "displayName"],
  },
  state: {
    noun: "workflow state",
    connection: "workflowStates",
    selection: "id name type color team { id key name }",
    matchKeys: ["name"],
  },
  label: {
    noun: "issue label",
    connection: "issueLabels",
    selection: "id name color team { id key name }",
    matchKeys: ["name"],
  },
  "project-label": {
    noun: "project label",
    connection: "projectLabels",
    selection: "id name color archivedAt",
    matchKeys: ["name"],
  },
  "initiative-label": {
    noun: "initiative label",
    connection: "initiativeLabels",
    selection: "id name color archivedAt",
    matchKeys: ["name"],
  },
  project: {
    noun: "project",
    connection: "projects",
    selection: "id name slugId archivedAt",
    matchKeys: ["name", "slugId"],
  },
  initiative: {
    noun: "initiative",
    connection: "initiatives",
    selection: "id name slugId archivedAt",
    matchKeys: ["name", "slugId"],
  },
  document: {
    noun: "document",
    connection: "documents",
    selection: "id title slugId archivedAt",
    matchKeys: ["title", "slugId"],
  },
  "project-status": {
    noun: "project status",
    connection: "projectStatuses",
    selection: "id name color type team { id key name } archivedAt",
    matchKeys: ["name"],
  },
  milestone: {
    noun: "project milestone",
    connection: "projectMilestones",
    selection: "id name targetDate project { id name } archivedAt",
    matchKeys: ["name"],
  },
};

export type LookupKind = keyof typeof LOOKUPS;

export async function resolveIssue(client: LinearClient, reference: string): Promise<LinearNode> {
  const data = await client.request<{ issue: LinearNode | null }>(
    `query ResolveIssue($id: String!) { issue(id: $id) { id identifier title team { id key name } project { id name } } }`,
    { id: reference },
  );
  if (!data.issue) {
    throw new AxiError(`Issue not found: ${reference}`, "NOT_FOUND", [
      "Use an issue identifier such as ENG-123 or a Linear issue UUID",
    ]);
  }
  return data.issue;
}

export async function resolveLookup(
  client: LinearClient,
  kind: LookupKind,
  reference: string,
  options: { teamId?: string | undefined; projectId?: string | undefined } = {},
): Promise<LinearNode> {
  if (kind === "user" && reference.toLowerCase() === "me") {
    const data = await client.request<{ viewer: LinearNode }>(
      "query ResolveViewer { viewer { id name displayName email } }",
    );
    return data.viewer;
  }
  const definition = LOOKUPS[kind];
  if (!definition) throw new AxiError(`Unsupported lookup type: ${kind}`, "VALIDATION_ERROR");
  const normalized = reference.toLowerCase();
  const exactIdMatches: LinearNode[] = [];
  const nameMatches: LinearNode[] = [];
  let after: string | null = null;

  do {
    const data: Record<string, Connection<LinearNode>> = await client.request<Record<string, Connection<LinearNode>>>(
      `query Resolve($after: String) {
        ${definition.connection}(first: 250, after: $after, includeArchived: true${definition.extraArguments ?? ""}) {
          nodes { ${definition.selection} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after },
    );
    const connection: Connection<LinearNode> | undefined = data[definition.connection];
    if (!connection) throw new AxiError(`Linear returned no ${definition.noun} lookup data`, "API_ERROR");
    for (const node of connection.nodes) {
      if (node.id === reference) exactIdMatches.push(node);
      if (options.teamId && node.team?.id !== options.teamId) continue;
      if (options.projectId && node.project?.id !== options.projectId) continue;
      if (definition.matchKeys.some((key) => String(node[key] ?? "").toLowerCase() === normalized)) {
        nameMatches.push(node);
      }
    }
    after = connection.pageInfo.hasNextPage ? (connection.pageInfo.endCursor ?? null) : null;
  } while (after);

  if (exactIdMatches[0]) return exactIdMatches[0];
  if (nameMatches.length === 1 && nameMatches[0]) return nameMatches[0];
  if (nameMatches.length > 1) {
    const candidates = nameMatches
      .slice(0, 8)
      .map((node) => `${node.name ?? node.title ?? node.email ?? "unnamed"} (${node.id})`);
    throw new AxiError(`Ambiguous ${definition.noun}: ${reference}`, "VALIDATION_ERROR", [
      `Use one of these IDs: ${candidates.join(", ")}`,
    ]);
  }
  throw new AxiError(`${capitalize(definition.noun)} not found: ${reference}`, "NOT_FOUND", [
    `Run \`linear-axi lookup ${lookupPlural(kind)}\` to list available values`,
  ]);
}

export async function resolveMany(
  client: LinearClient,
  kind: LookupKind,
  references: string[],
  options: { teamId?: string | undefined; projectId?: string | undefined } = {},
): Promise<string[]> {
  const nodes = await Promise.all(references.map((reference) => resolveLookup(client, kind, reference, options)));
  return nodes.map((node) => node.id);
}

function lookupPlural(kind: LookupKind): string {
  if (kind === "state") return "states";
  if (kind === "milestone") return "milestones";
  if (kind === "project-status") return "project-statuses";
  if (kind === "project-label") return "project-labels";
  if (kind === "initiative-label") return "initiative-labels";
  return `${kind}s`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
