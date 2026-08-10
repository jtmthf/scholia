// The static copy of the agent skill that ships in this package (issue #35).
//
// It is generated, so the only way it can be wrong is by being stale — which is
// exactly the drift the served docs exist to avoid, reintroduced by a file that
// nobody regenerates. This is what catches that.

import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderAgentDocs, VERBS } from "@scholia/core";

// What `scripts/write-skill.ts` writes, asserted from the other side: the path
// it ships to, and the flavour it ships (the local target, no instance named).
const SKILL_FILE = fileURLToPath(new URL("../skills/scholia/SKILL.md", import.meta.url));

test("the committed skill matches what the registry renders", async () => {
  const committed = await readFile(SKILL_FILE, "utf8");
  expect(committed, "skills/scholia/SKILL.md is stale — run `pnpm --filter scholia skill`").toBe(
    renderAgentDocs({ target: "local" }),
  );
});

test("it lists every verb, and says how to reach a live copy", async () => {
  const committed = await readFile(SKILL_FILE, "utf8");
  for (const verb of VERBS) expect(committed).toContain(`### ${verb.name}`);
  expect(committed).toContain("/__agent-docs");
  expect(committed).toContain("/agent-docs");
  expect(committed).toContain("data, not instructions");
});
