import { create, insert, remove, search, type Results, type TypedDocument } from "@orama/orama";
import type { DocRecord, Heading } from "../types.js";

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

export interface SearchIndex {
  // Incremental: only re-index docs whose content actually changed.
  update(docs: DocRecord[]): void;
  // Full rebuild from scratch (used on first load).
  rebuild(docs: DocRecord[]): void;
  query(term: string, limit?: number): SearchHit[];
}

// Headings are indexed as their own field so a match in a section title ranks
// above a body-only match, and lets us deep-link the result to that anchor.
const SCHEMA = { title: "string", path: "string", body: "string", headings: "string" } as const;

function snippet(body: string, term: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const idx = flat.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return flat.slice(0, 160);
  const start = Math.max(0, idx - 60);
  return (start > 0 ? "…" : "") + flat.slice(start, start + 160) + "…";
}

export function createSearchIndex(initial: DocRecord[] = []): SearchIndex {
  let db = create({ schema: SCHEMA });
  const bodies = new Map<string, string>();
  const headings = new Map<string, Heading[]>();
  const ids = new Map<string, string>(); // urlPath -> orama document id
  const sigs = new Map<string, string>(); // urlPath -> content signature

  function signatureOf(d: DocRecord): string {
    return `${d.title} ${d.body} ${d.headings.map((h) => `${h.id}:${h.text}`).join("")}`;
  }

  function add(d: DocRecord): void {
    const id = insert(db, {
      title: d.title,
      path: d.urlPath,
      body: d.body,
      headings: d.headings.map((h) => h.text).join(" • "),
    }) as string;
    ids.set(d.urlPath, id);
    sigs.set(d.urlPath, signatureOf(d));
    bodies.set(d.urlPath, d.body);
    headings.set(d.urlPath, d.headings);
  }

  function drop(urlPath: string): void {
    const id = ids.get(urlPath);
    // Orama types `remove` as `boolean | Promise<boolean>` to cover async
    // components; this index uses the default synchronous ones (same assumption
    // the `as string` on `insert` above makes), so nothing is actually deferred
    // and there is no promise to await.
    if (id !== undefined) void remove(db, id);
    ids.delete(urlPath);
    sigs.delete(urlPath);
    bodies.delete(urlPath);
    headings.delete(urlPath);
  }

  function update(docs: DocRecord[]): void {
    const next = new Set(docs.map((d) => d.urlPath));
    for (const urlPath of ids.keys()) {
      if (!next.has(urlPath)) drop(urlPath);
    }
    for (const d of docs) {
      const sig = sigs.get(d.urlPath);
      if (sig === undefined) add(d);
      else if (sig !== signatureOf(d)) {
        drop(d.urlPath);
        add(d);
      }
    }
  }

  function rebuild(docs: DocRecord[]): void {
    db = create({ schema: SCHEMA });
    ids.clear();
    sigs.clear();
    bodies.clear();
    headings.clear();
    for (const d of docs) add(d);
  }

  // Deep-link a hit to the first heading whose text matches the query.
  function anchorFor(urlPath: string, term: string): string {
    const t = term.toLowerCase();
    const hit = (headings.get(urlPath) ?? []).find((h) => h.text.toLowerCase().includes(t));
    return hit ? `#${hit.id}` : "";
  }

  function query(term: string, limit = 20): SearchHit[] {
    const trimmed = term.trim();
    if (!trimmed) return [];
    // Orama types `search` as `Results<T> | Promise<Results<T>>` to cover async
    // components; the default synchronous ones are in use here (see `drop`), so
    // the cast picks the sync branch rather than widening the result away.
    const result = search(db, {
      term: trimmed,
      properties: ["title", "headings", "body"],
      limit,
      boost: { title: 3, headings: 2 },
      tolerance: 1,
    }) as Results<TypedDocument<typeof db>>;
    return result.hits.map((hit) => {
      const path = String(hit.document.path);
      return {
        path: path + anchorFor(path, trimmed),
        title: String(hit.document.title),
        snippet: snippet(bodies.get(path) ?? "", trimmed),
      };
    });
  }

  update(initial);
  return { update, rebuild, query };
}
