// @-mention parsing (M7, CONTEXT "Mention"). A Mention is an `@`-reference to an
// existing Identity on a Site (`@owner-agent`, `@Jane`) used to route/address
// feedback: it surfaces in an agent's `list_comments --mentions` filter. We store
// the raw target token as typed; matching is case-insensitive (see `mentionsMatch`).
//
// Grammar: `@` followed by one or more of [A-Za-z0-9_-], not immediately preceded
// by a word character (so emails like `a@b` don't produce a spurious `@b`).

import { guardRegexInput } from "./safe-regex.js";

const MENTION_RE = /(^|[^\w@/])@([A-Za-z0-9][A-Za-z0-9_-]*)/g;

// Extract the ordered, de-duplicated list of mention targets from a comment body.
// De-duplication is case-insensitive but preserves the first-seen original casing.
export function parseMentions(body: string): string[] {
  // Input-length guard: a single comment body should never exceed 50 KB.
  guardRegexInput(body);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const target = m[2]!;
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

// Whether a stored mention target addresses a given identity name. Case-insensitive
// and slug-tolerant: an identity display name of "Owner's agent" matches a mention
// of `@owner-agent`. The possessive "'s" is dropped (Owner's → owner) so the natural
// handle a human types (`@owner-agent`) routes to the default "Owner's agent" label;
// remaining apostrophes are stripped and every other run of non-alphanumerics
// collapses to a single hyphen. Keep in sync with `normalizeMention` in @scholia/db.
export function mentionsMatch(target: string, identityName: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/['']s\b/g, "")
      .replace(/['']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return norm(target) === norm(identityName);
}
