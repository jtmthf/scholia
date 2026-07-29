import { useEffect, useState } from "preact/hooks";
import { getViewer, subscribeViewer, type StoredViewer } from "../viewer.js";
import { getOwnerToken, subscribeOwnerToken } from "../owner.js";

// Both stores live in localStorage, which the server can't see. So both hooks
// return null on the server *and* on the first client render, then fill in after
// mount: the SSR'd markup is what an anonymous first-time reader sees, and
// hydration matches it exactly rather than fighting it (ADR-0011).

/** The stored Viewer for a Site, or null until mounted / until one is minted. */
export function useViewer(slug: string): StoredViewer | null {
  const [viewer, setViewer] = useState<StoredViewer | null>(null);
  useEffect(() => {
    setViewer(getViewer(slug));
    return subscribeViewer(() => setViewer(getViewer(slug)));
  }, [slug]);
  return viewer;
}

/** The Viewer's id, or null — the shape the query keys and API calls want. */
export function useViewerId(slug: string): string | null {
  return useViewer(slug)?.viewerId ?? null;
}

/** The Owner token held for a Site, or null. Gates every owner-only affordance. */
export function useOwnerToken(slug: string): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    setToken(getOwnerToken(slug));
    return subscribeOwnerToken(() => setToken(getOwnerToken(slug)));
  }, [slug]);
  return token;
}
