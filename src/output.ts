import { AxiError } from "axi-sdk-js";
import type { Connection } from "./client.js";

export type OutputRecord = Record<string, unknown>;

export function compact<T extends OutputRecord>(record: T): OutputRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

export function truncate(value: string | null | undefined, limit: number): { text: string; truncated: boolean } {
  const text = value ?? "";
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}... (truncated, ${text.length} chars total)`, truncated: true };
}

export function listOutput<T>(
  noun: string,
  connection: Connection<T>,
  items: OutputRecord[],
  options: { limit: number; command: string; emptyContext?: string },
): OutputRecord {
  const total = connection.totalCount;
  const count: string | number = total === undefined
    ? (connection.pageInfo.hasNextPage ? `${items.length} shown (more available)` : items.length)
    : `${items.length} of ${total} total`;
  if (items.length === 0) {
    return {
      count: 0,
      [noun]: `0 ${options.emptyContext ?? noun} found`,
      help: [`Run \`${options.command}\` with broader filters`, `Run \`linear-axi --help\` to discover commands`],
    };
  }
  const output: OutputRecord = { count, [noun]: items };
  if (connection.pageInfo.hasNextPage && connection.pageInfo.endCursor) {
    output.page = { hasNextPage: true, endCursor: connection.pageInfo.endCursor };
    output.help = [`Run \`${options.command} --after ${connection.pageInfo.endCursor}\` for the next page`];
  }
  return output;
}

export function selectFields(
  item: OutputRecord,
  requested: string | undefined,
  defaults: string[],
  allowed: string[],
): OutputRecord {
  const fields = requested
    ? requested.split(",").map((field) => field.trim()).filter(Boolean)
    : defaults;
  const unknown = fields.filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    throw new AxiError(`Unknown output field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`, "VALIDATION_ERROR", [
      `Valid fields: ${allowed.join(", ")}`,
    ]);
  }
  return Object.fromEntries(fields.map((field) => [field, item[field] ?? null]));
}

export function mutationOutput(noun: string, action: string, item?: OutputRecord): OutputRecord {
  const output: OutputRecord = { result: `${noun} ${action}` };
  if (item) output[noun] = compact(item);
  return output;
}

export function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

export function names(nodes: Array<{ name?: string }> | undefined): string[] {
  return (nodes ?? []).flatMap((node) => (node.name ? [node.name] : []));
}
