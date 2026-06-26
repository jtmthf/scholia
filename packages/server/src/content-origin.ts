import type { AppDeps } from "./config.js";

// The content origin (ADR-0003): where a Site's Page HTML + Assets are served,
// distinct from the app origin so untrusted page JS is contained. M4 makes the
// base configurable and optionally per-Site.
//
//  - default (dev/test): path-based on `contentUrl` (== app origin when unset)
//    -> http://host/content/sites/<slug>
//  - wildcard (prod): per-Site subdomain on `contentUrl`'s host, giving each
//    Site its own opaque origin -> https://<slug>.usercontent.example/content/sites/<slug>
//
// The slug is still carried in the path either way so the route table (and the
// dev fallback) need no Host-based dispatch; the subdomain only changes the
// browser's origin for isolation.
export function contentBaseFor(slug: string, deps: AppDeps): string {
  if (!deps.contentWildcard) return `${deps.contentUrl}/content/sites/${slug}`;
  const url = new URL(deps.contentUrl);
  url.host = `${slug}.${url.host}`;
  return `${url.origin}/content/sites/${slug}`;
}

// CSP for content documents (PLAN §2, the user-chosen "lock framing + outbound"
// posture). `frame-ancestors` pins the embedder to the viewer origin so the
// content can't be reframed elsewhere; `default-src 'self'` plus self/inline
// script+style preserve page interactivity and self-hosted assets (ADR-0003)
// while denying outbound connections to the app origin or third parties.
// `object-src 'none'` and `base-uri 'self'` close common escape hatches.
export function contentCsp(deps: AppDeps): string {
  return [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${deps.viewerUrl}`,
  ].join("; ");
}
