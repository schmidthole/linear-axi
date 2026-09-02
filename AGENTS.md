# AGENTS.md

## Project map

- `bin/linear-axi.ts` is the dependency-light executable boundary. Keep the version check ahead of the dynamic CLI import.
- `src/cli.ts` owns top-level AXI dispatch, JSON mode, the live home view, and structured error rendering.
- `src/client.ts` is the only Linear transport. It reads `LINEAR_API_KEY`, sends GraphQL, sanitizes errors, and implements cursor-based total counting.
- `src/commands/` contains one command group per Linear domain plus lookups, raw GraphQL, and explicit hook setup.
- `src/graphql.ts` contains reusable selection sets. Avoid feature-gated fields in shared selections.
- `src/resolve.ts` converts names, keys, emails, issue identifiers, and UUIDs into mutation-safe IDs.
- `src/args.ts` provides non-interactive per-command parsing and strict unknown-flag rejection.
- `src/output.ts` keeps default schemas small, applies `--fields`, truncates content, and creates definitive empty/list states.
- `src/help.ts` is shared by top-level CLI help and the generated skill.
- `scripts/build-skill.ts` generates `skills/linear-axi/SKILL.md`; CI runs it with `--check`.

## Adding an operation

1. Confirm the current Linear mutation/query and input/payload types with authenticated GraphQL introspection. Linear's schema evolves and some fields are workspace-feature-gated.
2. Add a narrowly scoped subcommand in the relevant `src/commands/*.ts` file. Define its usage, required arguments, valid flags, and 2–3 examples next to the handler.
3. Resolve all human references through `src/resolve.ts` before a mutation. Never pass an unverified name as an ID.
4. Validate required and unknown input before the first API request. Use `AxiError` with `VALIDATION_ERROR` for usage problems.
5. Return plain JSON-shaped objects. The CLI boundary emits TOON by default and JSON for `--json`.
6. Keep default list rows to roughly four decision-making fields; add optional fields through `--fields`. Truncate long content and expose `--full`.
7. For a paginated list, include `pageInfo` in GraphQL and use `attachTotalCount` when the request begins at the first page.
8. Add unit/CLI contract coverage. Live-test mutations only on clearly named throwaway entities and clean them up; never mutate pre-existing workspace data.
9. Update README command references and `src/help.ts` when the top-level surface changes, then run `npm run build:skill`.

## Validation

Run `npm run typecheck`, `npm test`, `npm run check:skill`, and `npm pack --dry-run`. Live checks require an exported `LINEAR_API_KEY`; tests must not require or print a real key.

## Secrets and safety

Never commit or log a Linear key. Do not add a CLI flag for credentials. `.env` and `.env.*` remain ignored except for the placeholder `.env.example`.

Workspace-wide project statuses are shared configuration. Do not live-mutate them during routine validation. Permanent deletes must target only throwaway records created by the same validation run.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
