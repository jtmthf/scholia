// Anonymous Viewer identity — per-Site, stored in localStorage.
// "private from casual view, not secure" — CONTEXT "Viewer".
// Key: collab:viewer:<slug> → { viewerId: string; displayName?: string }

import { mintViewer } from "./api";

interface StoredViewer {
  viewerId: string;
  displayName?: string;
}

function storageKey(slug: string): string {
  return `collab:viewer:${slug}`;
}

function readStored(slug: string): StoredViewer | null {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return null;
    return JSON.parse(raw) as StoredViewer;
  } catch {
    return null;
  }
}

function writeStored(slug: string, viewer: StoredViewer): void {
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify(viewer));
  } catch {
    // localStorage may be unavailable (private browsing quota exhausted, etc.)
  }
}

/** Read the stored Viewer for a Site, or null if none yet. */
export function getViewer(slug: string): StoredViewer | null {
  return readStored(slug);
}

/**
 * Return the stored Viewer, minting one via the API if this is the first
 * interaction. Persists the returned id. Call only when the user is about to
 * act (e.g. submit a comment) — never eagerly.
 */
export async function ensureViewer(slug: string): Promise<StoredViewer> {
  const existing = readStored(slug);
  if (existing) return existing;
  const { viewerId } = await mintViewer(slug);
  const viewer: StoredViewer = { viewerId };
  writeStored(slug, viewer);
  return viewer;
}

/** Persist a display name for the Viewer. */
export function setDisplayName(slug: string, name: string): void {
  const existing = readStored(slug) ?? { viewerId: "" };
  writeStored(slug, { ...existing, displayName: name });
}
