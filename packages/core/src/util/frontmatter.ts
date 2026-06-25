import matter from "gray-matter";

export interface Frontmatter {
  data: Record<string, unknown>;
  content: string;
}

const FENCE_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

// Parse YAML frontmatter, but never throw: real-world docs sometimes contain
// malformed frontmatter (e.g. markdown checklists inside the YAML block). On a
// parse error we strip the leading fence and keep the document body.
export function parseFrontmatter(raw: string): Frontmatter {
  try {
    const result = matter(raw);
    return { data: (result.data ?? {}) as Record<string, unknown>, content: result.content };
  } catch {
    const match = FENCE_RE.exec(raw);
    return { data: {}, content: match ? raw.slice(match[0].length) : raw };
  }
}
