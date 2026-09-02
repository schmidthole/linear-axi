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

When the binary is not installed globally, replace \`linear-axi\` with \`npx -y linear-axi\`.
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
