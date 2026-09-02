---
name: linear-axi
description: Manage Linear issues, projects, initiatives, and documents through an agent-ergonomic CLI.
---

# linear-axi

Use linear-axi to manage Linear without opening the web app.

Authentication: LINEAR_API_KEY must contain a Linear personal API key.

Command map:
- issue: create, get, list/search, update, comment, assign, state, priority, estimate, labels, sub-issues, relations, archive, unarchive, delete
- project: create, get, list/search, update, archive/delete, issue membership, statuses, milestones
- initiative: create, get, list, update, archive/delete, labels, project links
- document: create, get, list/search, update, delete
- lookup: teams, users, workflow states, labels, project statuses, milestones, priorities
- api: authenticated escape hatch for arbitrary Linear GraphQL operations

Output is concise TOON by default. Add --json after the command for JSON. Use --fields on list/detail commands and --full on content-bearing detail commands.

Run linear-axi <noun> --help or linear-axi <noun> <action> --help before an unfamiliar mutation. All commands are non-interactive.


## Top-level reference

```text
usage: linear-axi [command] [args] [flags]
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
```

When the binary is not installed globally, replace `linear-axi` with `npx -y linear-axi`.
