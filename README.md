# linear-axi

`linear-axi` is an agent-ergonomic command-line interface for Linear. It covers common issue, project, initiative, and document work without requiring an agent—or its captain—to open the Linear web app.

It follows the [AXI](https://github.com/kunchenguid/axi) conventions:

- concise [TOON](https://toonformat.dev/) output by default;
- JSON with `--json` when a machine-readable interchange format is preferable;
- no interactive prompts;
- strict unknown-flag validation and actionable structured errors;
- small list schemas, `--fields` expansion, content previews, definitive totals, and cursor hints;
- `--help` at every command layer and a dependency-light `-v`/`-V`/`--version` fast path.

## Install

Requires Node.js 20 or newer.

```sh
npm install -g linear-axi
linear-axi --version
```

Until the package is published, install from a checkout:

```sh
npm install
npm run build
npm link
linear-axi --version
```

For one-off use after publication:

```sh
npx -y linear-axi issue list --assignee me
```

## Authentication

Create a personal API key in Linear under **Settings → Security & access → API**, then export it:

```sh
export LINEAR_API_KEY=lin_api_your_key_here
```

`linear-axi` reads only `LINEAR_API_KEY`. It never accepts a key as a flag or writes it to disk. `.env`, `.env.*`, and other local secret files are gitignored; [`.env.example`](.env.example) contains a placeholder only.

## Output and discovery

Run without arguments for a compact home view containing the current viewer and assigned issues:

```sh
linear-axi
```

TOON is the default stdout format. Put `--json` anywhere after the top-level command for JSON:

```sh
linear-axi issue list --assignee me --json
linear-axi project get "Gravity Migration" --json
```

List and detail commands support `--fields`; content-bearing detail commands support `--full`:

```sh
linear-axi issue list --fields identifier,title,status,priority,url
linear-axi issue get GRAVY-12 --full
```

Help is scoped to the command being used:

```sh
linear-axi --help
linear-axi issue --help
linear-axi issue create --help
linear-axi project milestone create --help
```

## Command surface

References may be Linear UUIDs. Issue references may also be identifiers such as `ENG-123`; teams accept keys; people accept email, name, UUID, or `me`; other entities accept exact names where unambiguous. Use `none` on supported update flags to clear a relationship or value.

### Issues

```text
linear-axi issue list [filters]
linear-axi issue search <query> [filters]
linear-axi issue get <issue> [--full] [--fields ...]
linear-axi issue create --team <team> --title <title> [fields]
linear-axi issue update <issue> [fields]
linear-axi issue comment <issue> (--body <markdown> | --body-file <path>)
linear-axi issue assign <issue> <user|none>
linear-axi issue state <issue> <state>
linear-axi issue priority <issue> <no|urgent|high|medium|low|0-4>
linear-axi issue estimate <issue> <points|none>
linear-axi issue label <add|remove> <issue> <label>
linear-axi issue subissue <add|remove> <parent> <child>
linear-axi issue subissue list <parent>
linear-axi issue relation add <issue> <related> --type <blocks|blocked-by|related|duplicate|similar>
linear-axi issue relation list <issue>
linear-axi issue relation remove <relation-id>
linear-axi issue archive <issue>
linear-axi issue unarchive <issue>
linear-axi issue delete <issue> [--permanent]
```

List/search filters include `--team`, `--assignee`, `--state`, `--project`, repeatable `--label`, `--priority`, `--include-archived`, `--limit`, and `--after`.

Create/update fields include title, Markdown description or description file, assignee, workflow state, team, project, project milestone, parent, labels, priority, estimate, and due date. `--label` on `update` replaces the issue's complete label set; the `label add/remove` actions make incremental changes.

Examples:

```sh
linear-axi issue create --team ENG --title "Fix login timeout" --assignee me --priority high
linear-axi issue search "login timeout" --team ENG --state "In Progress"
linear-axi issue update ENG-123 --project "Q4 reliability" --label bug
linear-axi issue relation add ENG-123 ENG-456 --type blocked-by
```

### Projects

```text
linear-axi project list [filters]
linear-axi project search <query> [filters]
linear-axi project get <project> [--full] [--fields ...]
linear-axi project create --name <name> --team <team> [--team <team> ...] [fields]
linear-axi project update <project> [fields]
linear-axi project archive <project>
linear-axi project unarchive <project>
linear-axi project delete <project>
linear-axi project add-issue <project> <issue>
linear-axi project remove-issue <project> <issue>

linear-axi project status list [--team <team>]
linear-axi project status set <project> <status>
linear-axi project status create --name <name> --color <hex> --type <type> [--team <team>]
linear-axi project status update <status> [fields]
linear-axi project status archive <status>
linear-axi project status unarchive <status>

linear-axi project milestone list [project]
linear-axi project milestone create <project> --name <name> [fields]
linear-axi project milestone update <milestone> [fields]
linear-axi project milestone move <milestone> <project>
linear-axi project milestone delete <milestone>
```

Project fields include description, long-form content, status, lead, members, accessible teams, labels, priority, dates, icon, and color.

Linear's public `projectDelete` mutation is archive-style and returns a project archive payload; it does not expose a permanent project-delete mutation. Consequently, `project archive` and `project delete` both use that public archive operation, and `project unarchive` restores it.

### Initiatives

```text
linear-axi initiative list [--status ...] [--owner ...] [--team ...] [--priority ...]
linear-axi initiative get <initiative> [--full] [--fields ...]
linear-axi initiative create --name <name> [fields]
linear-axi initiative update <initiative> [fields]
linear-axi initiative archive <initiative>
linear-axi initiative unarchive <initiative>
linear-axi initiative delete <initiative>
linear-axi initiative link-project <initiative> <project>
linear-axi initiative unlink-project <initiative> <project>
linear-axi initiative label <add|remove> <initiative> <label>
```

Initiative fields include description, content, owner, lead team, status, priority, target date, labels, icon, and color.

### Documents

```text
linear-axi document list [filters]
linear-axi document search <query> [filters]
linear-axi document get <document> [--full] [--fields ...]
linear-axi document create --title <title> [fields]
linear-axi document update <document> [fields]
linear-axi document delete <document>
```

Documents can be attached to a project, initiative, team, or issue and assigned an owner. Content may be supplied inline or with `--content-file`.

Linear's public `documentDelete` operation is archive-style and returns a document archive payload. The current public mutation schema has no `documentUnarchive` operation and no permanent document-delete operation; the CLI reports the resulting `archivedAt` value.

### Supporting lookups

```sh
linear-axi lookup teams
linear-axi lookup users
linear-axi lookup states --team ENG
linear-axi lookup labels --team ENG
linear-axi lookup project-labels
linear-axi lookup initiative-labels
linear-axi lookup project-statuses
linear-axi lookup milestones --project "Q4 reliability"
linear-axi lookup priorities
```

Lookups return IDs plus the small set of fields needed to disambiguate later mutations.

### Raw GraphQL escape hatch

Common operations have first-class commands. For newer or uncommon Linear fields, `api` runs an authenticated GraphQL operation while retaining structured error handling:

```sh
linear-axi api --query 'query { viewer { id name email } }'
linear-axi api --query-file operation.graphql --variables '{"first":10}'
linear-axi api --query-file operation.graphql --variables-file variables.json --json
```

The key remains in the authorization header and is never included in the request document or output.

## Optional agent integration

An explicit setup command can install or repair SessionStart integrations for Claude Code, Codex, and OpenCode. Nothing is installed during ordinary CLI use.

```sh
linear-axi setup hooks
linear-axi setup hooks --scope project
linear-axi setup status
linear-axi setup remove
```

An installable agent skill is also packaged at [`skills/linear-axi/SKILL.md`](skills/linear-axi/SKILL.md). It is generated from the CLI's shared help source; CI rejects stale generated content.

## Live-validation notes

Development validation used a real Linear workspace while protecting existing data. Read/list/detail operations ran against existing records. Mutations ran only against clearly named `linear-axi live test ...` throwaway issues, projects, initiatives, milestones, relations, comments, and documents, which were deleted or archived afterward.

The following shared-configuration/destructive cases are implemented and covered by local contract tests but intentionally were not mutated live:

- creating, updating, archiving, or reassigning workspace project-status definitions;
- permanently deleting any pre-existing record;
- moving a milestone into a pre-existing real project.

## Development

```sh
npm install
npm run typecheck
npm test
npm run check:skill
npm pack --dry-run
```

The code targets the Linear GraphQL schema as introspected on 2026-09-02. See [`AGENTS.md`](AGENTS.md) for architecture and extension guidance.
