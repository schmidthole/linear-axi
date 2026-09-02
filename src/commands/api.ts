import { readFile } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";
import { parseArgs, stringFlag, type CommandDefinition } from "../args.js";
import type { LinearClient } from "../client.js";
import type { OutputRecord } from "../output.js";

const API_HELP = `usage: linear-axi api (--query <graphql> | --query-file <path>) [flags]
flags:
  --query <graphql>       GraphQL query or mutation text
  --query-file <path>     Read GraphQL text from a file
  --variables <json>      JSON variables object
  --variables-file <path> Read JSON variables from a file
examples:
  linear-axi api --query 'query { viewer { id name email } }'
  linear-axi api --query-file query.graphql --variables '{"first":10}'
`;

export async function apiCommand(args: string[], client: LinearClient): Promise<OutputRecord | string> {
  if (args.includes("--help")) return API_HELP;
  const definition: CommandDefinition = {
    usage: "linear-axi api", description: "Run an authenticated Linear GraphQL operation",
    flags: {
      "--query": { type: "string", description: "GraphQL operation text" },
      "--query-file": { type: "string", description: "Read GraphQL operation from a file" },
      "--variables": { type: "string", description: "JSON variables object" },
      "--variables-file": { type: "string", description: "Read JSON variables from a file" },
    },
  };
  const parsed = parseArgs(args, definition);
  const query = await oneOfText(parsed.flags["--query"], parsed.flags["--query-file"], "query");
  const variablesText = await optionalOneOfText(parsed.flags["--variables"], parsed.flags["--variables-file"], "variables");
  let variables: Record<string, unknown> = {};
  if (variablesText !== undefined) {
    try {
      const parsedVariables = JSON.parse(variablesText) as unknown;
      if (!parsedVariables || Array.isArray(parsedVariables) || typeof parsedVariables !== "object") throw new Error("not an object");
      variables = parsedVariables as Record<string, unknown>;
    } catch {
      throw new AxiError("GraphQL variables must be a valid JSON object", "VALIDATION_ERROR");
    }
  }
  const data = await client.request<Record<string, unknown>>(query, variables);
  return { data };
}

async function oneOfText(value: unknown, file: unknown, label: string): Promise<string> {
  const result = await optionalOneOfText(value, file, label);
  if (result === undefined) throw new AxiError(`Provide --${label} or --${label}-file`, "VALIDATION_ERROR");
  return result;
}

async function optionalOneOfText(value: unknown, file: unknown, label: string): Promise<string | undefined> {
  if (typeof value === "string" && typeof file === "string") throw new AxiError(`Use only one of --${label} or --${label}-file`, "VALIDATION_ERROR");
  if (typeof value === "string") return value;
  if (typeof file === "string") {
    try { return await readFile(file, "utf8"); }
    catch { throw new AxiError(`Cannot read --${label}-file: ${file}`, "VALIDATION_ERROR"); }
  }
  return undefined;
}
