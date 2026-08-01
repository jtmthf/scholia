import type { VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { prerender } from "preact-iso";
import { locationStub } from "preact-iso/prerender";
import { dehydrate, type QueryClient } from "@tanstack/react-query";
import { App } from "./app.js";
import { Document, type Assets } from "./document.js";
import { serializeErrors } from "./data/error-serialization.js";
import { createQueryClient, prefetchSiteView } from "./data/queries.js";
import { matchSiteRoute, pinnedVersion } from "./routes.js";
import { ErrorView, NotFoundView } from "./shell/states.js";

export interface RenderResult {
  html: string;
  /** 404 when the URL names no Site, so a dead Share URL isn't a 200 (ADR-0001). */
  status: number;
}

/**
 * Render one viewer URL to a complete HTML document.
 *
 * What gets rendered is what every reader would see: the Site, its Nav, the Page's
 * content frame, and its public Threads. Anything keyed to *who* is reading —
 * Viewer identity, the Owner token, private Chats, `mine` affordances — lives in
 * localStorage, which the server can't see, so it appears after hydration by design
 * rather than by omission (ADR-0011).
 */
export async function render(url: string, assets: Assets): Promise<RenderResult> {
  const parsed = new URL(url, "http://localhost");
  const path = parsed.pathname + parsed.search;
  const client = createQueryClient();

  const matched = matchSiteRoute(parsed.pathname);
  if (matched) {
    const version = pinnedVersion(Object.fromEntries(parsed.searchParams));
    const result = await prefetchSiteView(client, matched.slug, matched.pagePath, version);

    // The failure views are rendered here rather than left to the shell's own
    // branches. An errored query that would refetch on mount reports as *pending*
    // during a one-shot render — "Loading…" forever in a document. Instead of
    // discarding the errored cache and forcing the client to refetch, we dehydrate
    // it with `shouldDehydrateQuery` so the client picks up the same error state,
    // skips the loading flash, and renders the correct view immediately.
    if (result.outcome === "not-found")
      return failureDocument(<NotFoundView />, 404, assets, client);
    if (result.outcome === "error") {
      return failureDocument(<ErrorView message={result.message} />, 500, assets, client);
    }
  }

  // The router reads `location` on both sides; on the server it's this stub. The
  // `url` prop says the same thing a second way, so a request can't pick up the
  // path of one that overlapped it.
  locationStub(path);
  const { html } = await prerender(<App client={client} url={path} />);

  // A URL that names no Site at all — anything outside `/s/...` — renders the
  // router's default route, and that is a 404 too.
  const status = matched ? 200 : 404;
  return { html: wrapInDocument(html, dehydrate(client), assets), status };
}

/**
 * A document for a URL that couldn't be rendered: just the failure view, with the
 * errored query cache behind it. The client hydrates, finds the same error in the
 * cache, and renders the failure view directly — no loading flash, no redundant
 * request.
 */
function failureDocument(
  view: VNode,
  status: number,
  assets: Assets,
  client: QueryClient,
): RenderResult {
  const state = dehydrate(client, { shouldDehydrateQuery: () => true });
  // Errors are not JSON-safe: their non-enumerable fields (name, message) would
  // be lost. Serialize them into plain objects before the cache is stringified.
  serializeErrors(state);
  const html = wrapInDocument(renderToString(view), state, assets);
  return { html, status };
}

function wrapInDocument(html: string, state: unknown, assets: Assets): string {
  const rendered = renderToString(
    <Document html={html} state={serializeState(state)} assets={assets} />,
  );
  return `<!doctype html>${rendered}`;
}

/**
 * JSON for embedding in a `<script>`: escaping `<` is what stops a Comment body
 * containing `</script>` from ending the tag and turning data into markup.
 */
export function serializeState(state: unknown): string {
  return JSON.stringify(state).replace(/</g, "\\u003c");
}
