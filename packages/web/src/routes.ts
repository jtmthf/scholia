// The viewer's URL shape, in one place: the router pattern, the inverse (building
// a URL), and reading the `?v=` pin out of a query. Both the client router and the
// SSR route match against these, so they can't drift apart.

import { guardRegexInput } from "@scholia/core";

/**
 * `/s/:slug` or `/s/:slug/<path>`. The Page path is a rest parameter because it
 * carries slashes (`guide/intro.md`) and the router decodes each segment.
 */
export const SITE_ROUTE = "/s/:slug/:pagePath*";

/** What the SITE_ROUTE pattern binds. `pagePath` is absent at the Site root. */
export interface SiteRouteParams {
  slug: string;
  pagePath?: string;
}

/**
 * The same match the client router performs, for the server, which has to know the
 * slug and Page path before it can prefetch anything.
 *
 * Hand-rolled rather than borrowed from the router: `preact-iso` exposes its matcher
 * only as an internal API (typed but absent from its entry point), and a route this
 * small isn't worth that coupling. It lives beside SITE_ROUTE and `sitePath` so all
 * three are read — and tested — together.
 */
export function matchSiteRoute(pathname: string): SiteRouteParams | null {
  // Input-length guard: URL pathnames are bounded by HTTP specs (typically < 2 KB).
  guardRegexInput(pathname, 8_192);
  const m = pathname.match(/^\/s\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  const rest = m[2];
  return {
    slug: decodeURIComponent(m[1]!),
    // Decoded per segment, so an encoded slash inside a segment survives as one.
    ...(rest ? { pagePath: rest.split("/").map(decodeURIComponent).join("/") } : {}),
  };
}

/**
 * `?v=<ordinal>` pins a historical Version (a read-only permalink, CONTEXT
 * "Latest"). Anything that isn't a Version ordinal means "Latest".
 */
export function pinnedVersion(query: Record<string, string>): number | null {
  const raw = query.v;
  if (raw === undefined) return null;
  const v = Number(raw);
  return Number.isInteger(v) && v >= 1 ? v : null;
}

/**
 * Build a viewer URL. `version` carries a pin forward across in-Site navigation,
 * so a permalink stays historical however the reader moves through the Site.
 */
export function sitePath(slug: string, pagePath?: string | null, version?: number | null): string {
  const base = `/s/${encodeURIComponent(slug)}${pagePath ? `/${pagePath}` : ""}`;
  return version === null || version === undefined ? base : `${base}?v=${version}`;
}
