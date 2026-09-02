import { readFile } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";

export type FlagType = "boolean" | "string" | "integer";

export interface FlagDefinition {
  type: FlagType;
  required?: boolean;
  repeatable?: boolean;
  default?: string | number | boolean;
  description: string;
}

export interface PositionalDefinition {
  name: string;
  required?: boolean;
}

export interface CommandDefinition {
  usage: string;
  description: string;
  flags?: Record<string, FlagDefinition>;
  positionals?: PositionalDefinition[];
  examples?: string[];
}

export interface ParsedArgs {
  flags: Record<string, string | number | boolean | string[]>;
  positionals: string[];
}

function validation(message: string, definition: CommandDefinition): never {
  throw new AxiError(message, "VALIDATION_ERROR", [
    `Run \`${definition.usage} --help\` for the command reference`,
  ]);
}

export function commandHelp(definition: CommandDefinition): string {
  const lines = [
    `usage: ${definition.usage}`,
    `description: ${definition.description}`,
  ];
  const positionals = definition.positionals ?? [];
  if (positionals.length > 0) {
    lines.push("arguments:");
    for (const positional of positionals) {
      lines.push(`  ${positional.name}${positional.required ? " (required)" : ""}`);
    }
  }
  const flags = definition.flags ?? {};
  const entries = Object.entries(flags);
  if (entries.length > 0) {
    lines.push("flags:");
    for (const [name, flag] of entries) {
      const value = flag.type === "boolean" ? "" : ` <${flag.type === "integer" ? "n" : "value"}>`;
      const qualifiers = [
        flag.required ? "required" : "",
        flag.repeatable ? "repeatable" : "",
        flag.default !== undefined ? `default ${String(flag.default)}` : "",
      ].filter(Boolean);
      lines.push(`  ${name}${value}${qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : ""}: ${flag.description}`);
    }
  }
  lines.push("  --help: Show this command reference");
  const examples = definition.examples ?? [];
  if (examples.length > 0) {
    lines.push("examples:", ...examples.map((example) => `  ${example}`));
  }
  return `${lines.join("\n")}\n`;
}

export function parseArgs(args: string[], definition: CommandDefinition): ParsedArgs {
  const flagDefinitions = definition.flags ?? {};
  const flags: Record<string, string | number | boolean | string[]> = {};
  const positionals: string[] = [];

  for (const [name, flag] of Object.entries(flagDefinitions)) {
    if (flag.default !== undefined) flags[name] = flag.default;
  }

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    if (token === "--help") validation("--help must be used by itself for this command", definition);
    if (!token.startsWith("--")) validation(`Unknown flag: ${token}`, definition);

    const equalsIndex = token.indexOf("=");
    const name = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
    const flag = flagDefinitions[name];
    if (!flag) {
      const valid = Object.keys(flagDefinitions);
      validation(
        `Unknown flag ${name}.${valid.length > 0 ? ` Valid flags: ${valid.join(", ")}` : " This command takes no flags."}`,
        definition,
      );
    }

    let value: string | number | boolean;
    if (flag.type === "boolean") {
      if (equalsIndex !== -1) validation(`${name} does not take a value`, definition);
      value = true;
    } else {
      const raw = equalsIndex === -1 ? args[index + 1] : token.slice(equalsIndex + 1);
      if (raw === undefined || (equalsIndex === -1 && raw.startsWith("--")) || raw.trim() === "") {
        validation(`${name} requires a value`, definition);
      }
      if (equalsIndex === -1) index += 1;
      if (flag.type === "integer") {
        if (!/^-?\d+$/.test(raw)) validation(`${name} must be an integer`, definition);
        value = Number(raw);
      } else {
        value = raw;
      }
    }

    if (flag.repeatable) {
      const previous = flags[name];
      const values = Array.isArray(previous) ? previous : [];
      values.push(String(value));
      flags[name] = values;
    } else if (flags[name] !== undefined && flag.default === undefined) {
      validation(`${name} may only be provided once`, definition);
    } else {
      flags[name] = value;
    }
  }

  const positionalDefinitions = definition.positionals ?? [];
  const requiredCount = positionalDefinitions.filter((item) => item.required).length;
  if (positionals.length < requiredCount) {
    const missing = positionalDefinitions[positionals.length]?.name ?? "argument";
    validation(`Missing required argument: ${missing}`, definition);
  }
  if (positionals.length > positionalDefinitions.length) {
    validation(`Unexpected argument: ${positionals[positionalDefinitions.length]}`, definition);
  }
  for (const [name, flag] of Object.entries(flagDefinitions)) {
    if (flag.required && flags[name] === undefined) validation(`${name} is required`, definition);
  }

  return { flags, positionals };
}

export function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function stringsFlag(parsed: ParsedArgs, name: string): string[] {
  const value = parsed.flags[name];
  return Array.isArray(value) ? value : [];
}

export function integerFlag(parsed: ParsedArgs, name: string): number | undefined {
  const value = parsed.flags[name];
  return typeof value === "number" ? value : undefined;
}

export function booleanFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}

export function boundedLimit(parsed: ParsedArgs, defaultValue = 50): number {
  const limit = integerFlag(parsed, "--limit") ?? defaultValue;
  if (limit < 1 || limit > 250) {
    throw new AxiError("--limit must be between 1 and 250", "VALIDATION_ERROR");
  }
  return limit;
}

export async function textInput(
  parsed: ParsedArgs,
  valueFlag: string,
  fileFlag: string,
  options: { required?: boolean; label?: string } = {},
): Promise<string | undefined> {
  const value = stringFlag(parsed, valueFlag);
  const file = stringFlag(parsed, fileFlag);
  if (value !== undefined && file !== undefined) {
    throw new AxiError(`Use only one of ${valueFlag} or ${fileFlag}`, "VALIDATION_ERROR");
  }
  if (value !== undefined) return value;
  if (file !== undefined) {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^.*?: /, "") : "unable to read file";
      throw new AxiError(`Cannot read ${fileFlag} ${file}: ${detail}`, "VALIDATION_ERROR");
    }
  }
  if (options.required) {
    throw new AxiError(`${options.label ?? valueFlag} is required; use ${valueFlag} or ${fileFlag}`, "VALIDATION_ERROR");
  }
  return undefined;
}

export const LIST_FLAGS: Record<string, FlagDefinition> = {
  "--limit": { type: "integer", description: "Maximum results (1-250)" },
  "--after": { type: "string", description: "Cursor from a previous response" },
  "--include-archived": { type: "boolean", description: "Include archived entities" },
  "--fields": { type: "string", description: "Comma-separated output fields" },
};
