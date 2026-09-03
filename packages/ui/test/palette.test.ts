import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The palette contract is the one part of @scholia/ui that no component test can
// reach: it is CSS, it is what two delivery packages disagreed about (issue #75),
// and the failure mode is a colour silently resolving to nothing. So it is checked
// here as text — the stylesheet against @scholia/theme, which is the shared source.

const commentsCss = readFileSync(
  fileURLToPath(new URL("../comments.css", import.meta.url)),
  "utf8",
);
const tokensCss = readFileSync(
  fileURLToPath(import.meta.resolve("@scholia/theme/tokens.css")),
  "utf8",
);

/** Every custom property declared anywhere in `css`. */
function declarations(css: string): Set<string> {
  const names = new Set<string>();
  for (const [, name] of stripComments(css).matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:/g)) {
    names.add(name!);
  }
  return names;
}

/** Every custom property declared inside the given selector's block. */
function declarationsUnder(css: string, selector: string): Set<string> {
  return declarations(block(css, selector));
}

/** The body of the first `selector { … }` block, braces matched. */
function block(css: string, selector: string): string {
  const stripped = stripComments(css);
  const start = stripped.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block`);
  let depth = 0;
  for (let i = stripped.indexOf("{", start); i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}" && --depth === 0) {
      return stripped.slice(stripped.indexOf("{", start) + 1, i);
    }
  }
  throw new Error(`unterminated ${selector} block`);
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every `var()` in `css`, as the name read and whether a fallback was supplied. */
function references(css: string): { name: string; hasFallback: boolean }[] {
  const stripped = stripComments(css);
  const found: { name: string; hasFallback: boolean }[] = [];
  for (let i = stripped.indexOf("var("); i !== -1; i = stripped.indexOf("var(", i + 1)) {
    let depth = 0;
    let end = i + 3;
    for (; end < stripped.length; end++) {
      if (stripped[end] === "(") depth++;
      else if (stripped[end] === ")" && --depth === 0) break;
    }
    const args = stripped.slice(i + 4, end);
    const comma = args.indexOf(",");
    found.push({
      name: (comma === -1 ? args : args.slice(0, comma)).trim(),
      hasFallback: comma !== -1 && args.slice(comma + 1).trim().length > 0,
    });
  }
  return found;
}

/** The names listed in the contract table at the top of comments.css. */
function documentedContract(css: string): Set<string> {
  const header = css.match(/\/\*[\s\S]*?\*\//)?.[0] ?? "";
  return new Set(header.match(/--scholia-comment-[a-z0-9-]+/g) ?? []);
}

const themeTokens = declarations(tokensCss);
const declared = declarations(commentsCss);
const contract = new Set(
  [...declared, ...references(commentsCss).map((r) => r.name)].filter((name) =>
    name.startsWith("--scholia-comment-"),
  ),
);

describe("the comment layer's palette contract", () => {
  it("resolves every colour it uses, given only @scholia/theme", () => {
    // A name is answered if the stylesheet declares it, the theme defines it, or
    // every read of it supplies a fallback. Anything else is a colour that comes
    // out empty in a consumer that imports nothing else — the issue-#75 bug.
    const unanswered = new Set<string>();
    for (const { name, hasFallback } of references(commentsCss)) {
      if (declared.has(name) || themeTokens.has(name) || hasFallback) continue;
      unanswered.add(name);
    }
    expect([...unanswered].sort()).toEqual([]);
  });

  it("names every consumer-supplied variable in the --scholia-comment-* namespace", () => {
    // The contract is a public API, so it must be greppable and must not collide
    // with whatever the surrounding surface calls its own colours.
    const overridable = references(commentsCss)
      .filter((r) => r.hasFallback)
      .map((r) => r.name);
    expect(overridable.filter((name) => !name.startsWith("--scholia-comment-"))).toEqual([]);
  });

  it("documents the contract at the top of the file", () => {
    expect([...documentedContract(commentsCss)].sort()).toEqual([...contract].sort());
  });

  it("defaults every contract name to a @scholia/theme token", () => {
    // Each public name is read exactly once, in the defaults block, with a theme
    // token behind it — that indirection is what makes an override work whatever
    // order the consumer's stylesheet lands in.
    const defaults = block(commentsCss, ":root");
    for (const name of contract) {
      const reads = references(commentsCss).filter((r) => r.name === name);
      expect(reads, `${name} is never read`).not.toHaveLength(0);
      expect(references(defaults).filter((r) => r.name === name)).toHaveLength(reads.length);
      for (const read of reads) {
        expect(read.hasFallback, `${name} is read with no default`).toBe(true);
      }
    }
    const fallbackTokens = references(defaults)
      .map((r) => r.name)
      .filter((name) => name.startsWith("--color-"));
    expect(fallbackTokens.length).toBeGreaterThan(0);
    for (const token of fallbackTokens) {
      expect(themeTokens, `${token} is not a @scholia/theme token`).toContain(token);
    }
  });

  it("states no colour of its own outside the defaults block", () => {
    // Hex literals below the defaults block are how the two palettes drifted in the
    // first place. Neutral scrims (rgba black) stay exempt: they are shadow, not ink.
    const rules = stripComments(commentsCss).replace(block(commentsCss, ":root"), "");
    expect(rules.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });
});

describe("@scholia/theme", () => {
  it("covers light and dark with the same token set", () => {
    // Local Preview switches scheme with a class, so a token defined only in :root
    // silently keeps its light value in dark — the bug this replaces.
    const light = declarationsUnder(tokensCss, ":root");
    const dark = declarationsUnder(tokensCss, "html.dark");
    const paletteOnly = (names: Set<string>) => [...names].filter((n) => n.startsWith("--color-"));
    expect(paletteOnly(dark).sort()).toEqual(paletteOnly(light).sort());
  });
});
