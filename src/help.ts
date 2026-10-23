export const TOP_LEVEL_HELP = `usage: linear-axi [command] [args] [flags]
commands[7]:
  issue, project, initiative, document, lookup, api, setup
flags[3]:
  --json (after command), --help, -v/-V/--version
examples:
  linear-axi
  linear-axi issue list --assignee me
  linear-axi issue get ENG-123
  linear-axi project list --json
  linear-axi lookup teams
  linear-axi setup hooks
`;

export const SKILL_GUIDE = `Use linear-axi to manage Linear without opening the web app.

Authentication: set exactly one of LINEAR_API_KEY (a Linear personal API key) or LINEAR_ACCESS_TOKEN (an OAuth access token, such as an actor=app agent token). Setting both is an AUTH_ERROR.

Agent apps: assigning an issue to an agent app sets its delegate, not its assignee. Use --delegate <user|me|none> on issue list/search/update; with an app token, me is the app user.

Command map:
- issue: create, get, list/search, update, comment, assign, state, priority, estimate, labels, sub-issues, relations, archive, unarchive, delete
- project: create, get, list/search, update, archive/delete, issue membership, statuses, milestones
- initiative: create, get, list, update, archive/delete, labels, project links
- document: create, get, list/search, update, delete
- lookup: teams, users, workflow states, labels, project statuses, milestones, priorities
- api: authenticated escape hatch for arbitrary Linear GraphQL operations

Output is concise TOON by default. Add --json after the command for JSON. Use --fields on list/detail commands and --full on content-bearing detail commands.

Run linear-axi <noun> --help or linear-axi <noun> <action> --help before an unfamiliar mutation. All commands are non-interactive.
`;
