import { useCallback } from "preact/hooks";
import { QueryClient, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchSite,
  fetchSummary,
  listChats,
  listConversations,
  SiteNotFoundError,
  type ConversationDTO,
  type SiteMeta,
  type ViewerSummary,
} from "../api.js";

/**
 * Query keys, hierarchical so a mutation can invalidate a Page's Conversations
 * without knowing which Viewer they were fetched for. `viewerId` is part of the
 * key because it changes the response — the server flags `mine` on Comments and
 * Reactions against it — which also means the anonymous fetch the server made
 * during SSR is a *different* entry from the one a Viewer makes after hydration,
 * rather than a stale version of it.
 */
export const queryKeys = {
  site: (slug: string, version: number | null) => ["site", slug, version] as const,
  conversations: (slug: string, pagePath: string, viewerId: string | null) =>
    ["conversations", slug, pagePath, viewerId] as const,
  chats: (slug: string, pagePath: string, viewerId: string) =>
    ["chats", slug, pagePath, viewerId] as const,
  summary: (slug: string, viewerId: string) => ["summary", slug, viewerId] as const,
};

/**
 * Refetch every Conversation list for one Page — both Threads and Chats, and under
 * whichever Viewer each was fetched for, since the keys are prefixes. This is what
 * "the mutation has landed" means to the comment layer, so both the port and the
 * new-Conversation composer end here rather than each spelling it out.
 */
export function useRefreshConversations(slug: string, pagePath: string): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all(
      [
        ["conversations", slug, pagePath],
        ["chats", slug, pagePath],
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  }, [client, slug, pagePath]);
}

/**
 * The cache's defaults are deliberately quiet: no retries and no refetch on window
 * focus, so adopting the cache changed *where* fetches are described, not when
 * they happen.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
    },
  });
}

export function useSite(slug: string, version: number | null): UseQueryResult<SiteMeta> {
  return useQuery({
    queryKey: queryKeys.site(slug, version),
    queryFn: () => fetchSite(slug, version ?? undefined),
  });
}

/** Public Threads on a Page. Anonymous until the reader has a Viewer. */
export function useConversations(
  slug: string,
  pagePath: string,
  viewerId: string | null,
  enabled: boolean,
): UseQueryResult<ConversationDTO[]> {
  return useQuery({
    queryKey: queryKeys.conversations(slug, pagePath, viewerId),
    queryFn: () => listConversations(slug, pagePath, viewerId),
    enabled,
  });
}

/**
 * The reader's own private Chats. Only a Viewer that already exists can have any,
 * and one is never minted just to look (the viewer.ts contract) — so with no
 * Viewer this query simply doesn't run and the Chats list is empty.
 */
export function useChats(
  slug: string,
  pagePath: string,
  viewerId: string | null,
  enabled: boolean,
): UseQueryResult<ConversationDTO[]> {
  return useQuery({
    queryKey: queryKeys.chats(slug, pagePath, viewerId ?? ""),
    queryFn: () => listChats(slug, pagePath, viewerId!),
    enabled: enabled && viewerId !== null,
  });
}

/**
 * "New since last visit" counts (CONTEXT "Last Seen Version").
 *
 * Fetched once per visit and held for exactly that visit, which takes both options
 * off the defaults. `staleTime: Infinity` because the counts are relative to the Last
 * Seen Version this very visit is about to advance — refetch and the server answers
 * "nothing new", emptying the banner while the reader is reading it. `gcTime: 0`
 * because that answer must not outlive the visit either: coming back to the Site
 * later in the session should ask again, and get the new, emptier truth.
 */
export function useViewerSummary(
  slug: string,
  viewerId: string | null,
  enabled: boolean,
): UseQueryResult<ViewerSummary> {
  return useQuery({
    queryKey: queryKeys.summary(slug, viewerId ?? ""),
    queryFn: () => fetchSummary(slug, viewerId),
    enabled: enabled && viewerId !== null,
    staleTime: Infinity,
    gcTime: 0,
  });
}

/** Whether a server-side prefetch found something to render. */
export type PrefetchResult =
  | { outcome: "ok" }
  | { outcome: "not-found" }
  | { outcome: "error"; message: string };

/**
 * Warm the cache for one viewer URL on the server: the Site, and the public
 * Threads on the Page it resolves to. Both are anonymous — the server has no
 * Viewer — which is exactly the pair that can be rendered for everyone.
 *
 * Resolves rather than rejects, reporting the outcome so the caller can set an
 * honest status code; the shell renders its own not-found/error view either way,
 * off the same failed query.
 */
export async function prefetchSiteView(
  client: QueryClient,
  slug: string,
  pagePath: string | undefined,
  version: number | null,
): Promise<PrefetchResult> {
  await client.prefetchQuery({
    queryKey: queryKeys.site(slug, version),
    queryFn: () => fetchSite(slug, version ?? undefined),
  });

  const site = client.getQueryData<SiteMeta>(queryKeys.site(slug, version));
  if (!site) {
    const error = client.getQueryState(queryKeys.site(slug, version))?.error;
    if (error instanceof SiteNotFoundError) return { outcome: "not-found" };
    return { outcome: "error", message: error instanceof Error ? error.message : String(error) };
  }

  // Comments live on Latest; a pinned historical Version is content-only.
  if (site.isLatest) {
    const path = pagePath ?? site.entryPath;
    await client.prefetchQuery({
      queryKey: queryKeys.conversations(slug, path, null),
      queryFn: () => listConversations(slug, path, null),
    });
  }
  return { outcome: "ok" };
}
