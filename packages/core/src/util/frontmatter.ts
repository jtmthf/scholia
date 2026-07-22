import { VFile } from "vfile";
import { matter } from "vfile-matter";

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
    const file = new VFile(raw);
    matter(file, { strip: true });
    return { data: (file.data.matter ?? {}) as Record<string, unknown>, content: String(file) };
  } catch {
    const match = FENCE_RE.exec(raw);
    return { data: {}, content: match ? raw.slice(match[0].length) : raw };
  }
}
