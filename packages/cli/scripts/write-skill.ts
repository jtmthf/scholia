// Writes the static copy of the agent skill that ships with this package
// (issue #35): `pnpm --filter scholia skill`.
//
// Every Scholia serves its own docs, generated from the verbs it answers. This
// copy exists for the moment before an agent has an instance to ask — so it is
// generated from the same renderer, and `test/skill.test.ts` fails when the
// committed file has fallen behind the registry.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAgentDocs } from "@scholia/core";

// `skills/<name>/SKILL.md` — the layout a skill installer expects to find.
const file = fileURLToPath(new URL("../skills/scholia/SKILL.md", import.meta.url));

// The local target, because that is what a fresh install has: a project on disk
// and no server. Naming no instance is what makes the closing section tell the
// reader how to fetch a live copy rather than claim to be one.
await mkdir(dirname(file), { recursive: true });
await writeFile(file, renderAgentDocs({ target: "local" }));
console.log(`[scholia] wrote ${file}`);
