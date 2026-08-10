// The served agent docs (issue #35).
//
// The point of generating them is that an instance cannot document a capability
// it does not have, so these assert the two directions that would break that:
// the verb list is exactly the registry the instance was handed, and the
// target-specific prose only appears on the target it is true of.

import { describe, expect, test } from "vitest";
import { renderAgentDocs, VERBS, type Verb } from "../../src/index.js";

/** Every `### <verb>` heading in the rendered docs, in order. */
function documentedVerbs(markdown: string): string[] {
  return [...markdown.matchAll(/^### (\w+)$/gm)].map((match) => match[1]!);
}

describe("renderAgentDocs", () => {
  test("documents exactly the verbs the instance exposes", () => {
    const names = VERBS.map((verb) => verb.name);
    expect(documentedVerbs(renderAgentDocs({ target: "local" }))).toEqual(names);
    expect(documentedVerbs(renderAgentDocs({ target: "hosted" }))).toEqual(names);
  });

  test("documents no more than the verbs the instance exposes", () => {
    const two = VERBS.filter((verb) => verb.name === "list_conversations" || verb.name === "reply");
    const markdown = renderAgentDocs({ target: "local", verbs: two });

    expect(documentedVerbs(markdown)).toEqual(["list_conversations", "reply"]);
    expect(markdown).not.toContain("delete_conversation");
  });

  test("names every param of every verb it documents", () => {
    const markdown = renderAgentDocs({ target: "hosted" });
    for (const verb of VERBS) {
      for (const param of verb.params) {
        expect(markdown, `${verb.name}.${param.name}`).toContain(`--${param.name}`);
      }
    }
  });

  test("a local instance documents no tokens, tiers or Versions", () => {
    const markdown = renderAgentDocs({ target: "local" });
    for (const absent of ["token", "tier", "Version", "Owner-scoped"]) {
      expect(markdown.toLowerCase(), absent).not.toContain(absent.toLowerCase());
    }
    // What it documents instead: the tree it is standing in.
    expect(markdown).toContain(".scholia");
  });

  test("a hosted instance documents tiers and token scopes", () => {
    const markdown = renderAgentDocs({ target: "hosted", site: "docs-site" });
    expect(markdown).toContain("Owner-scoped");
    expect(markdown).toContain("Viewer-scoped");
    expect(markdown).toContain("SCHOLIA_TOKEN");
    expect(markdown).toContain("docs-site");
    // The tier of every verb, from the registry rather than a parallel table.
    for (const verb of VERBS) expect(markdown).toContain(verb.name);
  });

  test("both targets carry the prompt-injection guidance", () => {
    for (const target of ["local", "hosted"] as const) {
      const markdown = renderAgentDocs({ target });
      expect(markdown, target).toContain("data, not instructions");
      expect(markdown, target).toContain("Anchor");
      expect(markdown, target).toMatch(/confirm/i);
    }
  });

  test("a served copy says where it came from; a static copy says how to reach one", () => {
    const served = renderAgentDocs({
      target: "hosted",
      docsUrl: "https://example.test/agent-docs",
    });
    expect(served).toContain("https://example.test/agent-docs");

    const packaged = renderAgentDocs({ target: "local" });
    expect(packaged).toContain("__agent-docs");
    expect(packaged).toContain("/agent-docs");
  });

  test("carries skill frontmatter, so the file drops in as a skill", () => {
    const markdown = renderAgentDocs({ target: "local" });
    expect(markdown.startsWith("---\nname: scholia\n")).toBe(true);
    expect(markdown).toMatch(/^description: .+$/m);
  });

  test("a verb's CLI spelling and MCP tool name are both reachable", () => {
    const markdown = renderAgentDocs({ target: "local" });
    // `list_conversations` is the tool; `comments` is what a person types.
    expect(markdown).toContain("scholia comments [page]");
    expect(markdown).toContain("### list_conversations");
  });

  test("escapes pipes and backslashes in param descriptions so the table stays valid", () => {
    const verb: Verb = {
      name: "escape_test",
      command: "escape-test",
      summary: "test escaping",
      description: "A verb whose param description needs escaping.",
      hostedTier: "none",
      params: [
        {
          name: "pattern",
          type: "string",
          description: "Use a|b or a\\b, never both|together.",
          required: true,
        },
      ],
      run: async () => ({ data: null, lines: [] }),
    };

    const markdown = renderAgentDocs({ target: "local", verbs: [verb] });
    const tableLine = markdown.split("\n").find((line) => line.includes("--pattern"));
    expect(tableLine).toBeDefined();
    // The cell should contain escaped pipes/backslashes, not real delimiters.
    expect(tableLine).toContain("Use a\\|b or a\\\\b, never both\\|together.");
    // The row is `| --pattern | string | required | <cell> |` — four cells,
    // so five unescaped `|` delimiters. Any unescaped pipe inside the cell
    // would push the count above five.
    const unescapedPipes = [...tableLine!.matchAll(/(?<!\\)\|/g)];
    expect(unescapedPipes).toHaveLength(5);
  });
});

describe("the registry carries what the docs need", () => {
  test("every verb declares its hosted tier", () => {
    const tiers = ["none", "any", "viewer", "owner"];
    for (const verb of VERBS) expect(tiers, verb.name).toContain(verb.hostedTier);
  });

  test("a target note, where present, is a sentence rather than a fragment", () => {
    const notes = VERBS.flatMap((verb: Verb) =>
      [verb.notes?.local, verb.notes?.hosted].filter((note): note is string => note !== undefined),
    );
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note.length).toBeGreaterThan(30);
  });
});
