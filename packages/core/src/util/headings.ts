import GithubSlugger from "github-slugger";
import type { Heading } from "../types.js";
import { guardRegexInput } from "./safe-regex.js";

// Strip the common inline markdown markers so a heading's slug matches the text
// content rehype-slug sees after parsing (e.g. "Use `foo`" -> "Use foo").
function stripInline(s: string): string {
  return s
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

// Extract ATX headings from markdown, computing the same slug ids that
// rehype-slug (github-slugger) produces at render time — a fresh slugger per
// document, walked in document order, mirrors rehype-slug's de-duplication.
// Fenced code blocks are skipped so `# comment` lines inside ``` are ignored.
export function extractHeadings(markdown: string): Heading[] {
  // Input-length guard: a single Page's markdown should never exceed 500 KB.
  // The guard prevents a maliciously large document from tying up the regex
  // engine during line-by-line heading extraction.
  guardRegexInput(markdown, 500_000);
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let fence: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = (fenceMatch[1] ?? "").charAt(0);
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const depth = (m[1] ?? "").length;
    const text = stripInline(m[2] ?? "").trim();
    if (!text) continue;
    headings.push({ depth, text, id: slugger.slug(text) });
  }
  return headings;
}
