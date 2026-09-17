import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SKILL_GUIDE, TOP_LEVEL_HELP } from "../src/help.js";

const target = resolve("skills/linear-axi/SKILL.md");
const generated = `---
name: linear-axi
description: Manage Linear issues, projects, initiatives, and documents through an agent-ergonomic CLI.
---

# linear-axi

${SKILL_GUIDE}

## Top-level reference

\`\`\`text
${TOP_LEVEL_HELP.trimEnd()}
\`\`\`

If the binary is missing, install this repository using the [README installation instructions](https://github.com/schmidthole/linear-axi#install), then run \`linear-axi --version\` and \`linear-axi --help\`. This project is not published to npm; do not use an unqualified npm install or npx command for \`linear-axi\`, because the npm package is unrelated.

Registry self-update is disabled. Use the README's source update instructions instead of \`linear-axi update\` or \`linear-axi update --check\`.
`;

if (process.argv.includes("--check")) {
  let current = "";
  try { current = await readFile(target, "utf8"); } catch { /* reported below */ }
  if (current !== generated) {
    process.stderr.write("skills/linear-axi/SKILL.md is stale; run npm run build:skill\n");
    process.exitCode = 1;
  }
} else {
  await mkdir(resolve("skills/linear-axi"), { recursive: true });
  await writeFile(target, generated, "utf8");
}
