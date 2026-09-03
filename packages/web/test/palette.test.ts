import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The hosted viewer keeps its own Primer-ish palette while @scholia/ui defaults to
// @scholia/theme's editorial one (ADR-0041), so the rail looks like the chrome
// around it only for as long as styles.css answers the whole contract. A name that
// falls through lands on an editorial colour in the middle of a GitHub-grey rail —
// visible, but only to whoever happens to open that affordance.

const styles = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const commentsCss = readFileSync(
  fileURLToPath(import.meta.resolve("@scholia/ui/comments.css")),
  "utf8",
);

/** The contract names @scholia/ui reads, from the source of truth rather than a list. */
const contract = [
  ...new Set(commentsCss.match(/var\(\s*(--scholia-comment-[a-z0-9-]+)/g) ?? []),
].map((match) => match.replace(/^var\(\s*/, ""));

/** Every custom property `css` declares, and what it was set to. */
function declared(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:([^;}]+)/g)) {
    out.set(name!, value!.trim());
  }
  return out;
}

/** The `@media (prefers-color-scheme: dark)` block, braces matched. */
function darkBlock(css: string): string {
  const start = css.indexOf("@media (prefers-color-scheme: dark)");
  if (start === -1) throw new Error("no dark block");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  throw new Error("unterminated dark block");
}

const light = declared(styles.slice(0, styles.indexOf("@media (prefers-color-scheme: dark)")));
const dark = declared(darkBlock(styles));

/** Is `name` given a dark value — itself, or by every variable it defers to? */
function hasDarkValue(name: string, seen: Set<string>): boolean {
  if (dark.has(name)) return true;
  if (seen.has(name)) return false; // a cycle answers nothing
  seen.add(name);
  const deferredTo = [...(light.get(name) ?? "").matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(
    (m) => m[1]!,
  );
  return deferredTo.length > 0 && deferredTo.every((next) => hasDarkValue(next, seen));
}

describe("the hosted viewer's answer to the comment layer's palette contract", () => {
  it("covers every name @scholia/ui reads", () => {
    expect(contract.length).toBeGreaterThan(0);
    expect(contract.filter((name) => !light.has(name))).toEqual([]);
  });

  it("gives every name a dark value, through however many variables it defers to", () => {
    // A name pinned to a hex has to be restated in the dark block; a name defined
    // as `var(--x)` is covered only if `--x` is — and `--x` may itself defer again.
    // Following the chain is the point: `--scholia-comment-warning: var(--outdated-fg)`
    // looks restated and is not, and staying light in dark mode is exactly how
    // #c0392b survived unadjusted for two schemes.
    const uncovered = contract.filter((name) => !hasDarkValue(name, new Set()));
    expect(uncovered).toEqual([]);
  });
});
