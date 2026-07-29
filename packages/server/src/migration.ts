import { migrateAnchor, renderedText } from "@scholia/core";
import {
  getLatestManifest,
  listConversationsForMigration,
  updateAnchorAfterMigration,
  type Anchor,
} from "@scholia/db";
import type { AppDeps } from "./config.js";

const decoder = new TextDecoder();

export interface MigrationReport {
  /** Conversations whose anchor re-resolved to the new Latest (or page still exists). */
  migrated: number;
  /** Conversations marked Outdated (quote no longer unique, or page removed). */
  outdated: number;
  /**
   * Of `migrated`, how many landed only via the exact-only fallback — the quoted
   * text survived but its surroundings were rewritten. Deliberately reported here
   * rather than shown to readers: the fallback fires often enough (roughly a
   * third of edits, per the migration-accuracy spike) that a per-Anchor marker
   * would be noise, but a rate that moves is worth an Owner's attention.
   */
  fallback: number;
}

// Re-resolve every Conversation's anchor against the newly-uploaded Latest Version
// (M6, ADR-0002). Anchored Conversations migrate by unique text-quote match against
// the Page's new rendered text; page-level Conversations follow their Page's path
// (a removed/renamed path makes them Outdated per CONTEXT "Page"). Runs once per
// re-upload, after the new Version is Latest.
export async function migrateConversationsToLatest(
  deps: AppDeps,
  slug: string,
  siteId: string,
): Promise<MigrationReport> {
  const { db, store } = deps;

  const manifest = await getLatestManifest(db, slug);
  const pageByPath = new Map((manifest?.pages ?? []).map((p) => [p.path, p]));

  // Lazily fetch + cache each Page's new rendered text (the migration key).
  const textCache = new Map<string, string | null>();
  async function textFor(path: string): Promise<string | null> {
    if (textCache.has(path)) return textCache.get(path)!;
    const page = pageByPath.get(path);
    let txt: string | null = null;
    if (page && (page.kind === "markdown" || page.kind === "html") && page.renderedHash) {
      const bytes = await store.get(page.renderedHash);
      txt = bytes ? renderedText(decoder.decode(bytes)) : null;
    }
    textCache.set(path, txt);
    return txt;
  }

  const candidates = await listConversationsForMigration(db, siteId);
  let migrated = 0;
  let outdated = 0;
  let fallback = 0;

  for (const c of candidates) {
    let status: "live" | "outdated";
    let anchor: Anchor | null = c.anchor;

    if (c.anchor === null) {
      // Page-level (or site-level) Conversation: live iff its Page still exists.
      status = c.pagePath === null || pageByPath.has(c.pagePath) ? "live" : "outdated";
    } else if (c.pagePath === null) {
      // Anchored but no page path (shouldn't happen); treat as page-level.
      status = "live";
    } else {
      const txt = await textFor(c.pagePath);
      if (txt === null) {
        status = "outdated"; // Page removed or not renderable.
      } else {
        const result = migrateAnchor(c.anchor, txt);
        status = result.status;
        anchor = result.anchor;
        if (result.matched === "exact") fallback++;
      }
    }

    if (status === "live") migrated++;
    else outdated++;

    // Only write when something actually changed.
    if (status !== c.anchorStatus || anchor !== c.anchor) {
      await updateAnchorAfterMigration(db, { id: c.id, anchorStatus: status, anchor });
    }
  }

  return { migrated, outdated, fallback };
}
