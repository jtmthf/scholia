// Serve-time rewriting of inter-Page links in a rendered Markdown Page. Stored
// rendered HTML stays portable (relative hrefs, content-addressed, origin-free);
// the binding to a concrete Site slug + viewer origin happens here, at serve
// time, when those are known (PLAN §5 M3; CONTEXT "Nav").
//
// A link that resolves (relative to the current Page) to another Markdown Page
// in the Site is rewritten to the parent viewer route `${viewerBase}/s/:slug/<path>`
// with `target="_top"` so the click navigates the top frame — keeping the
// comment chrome — rather than swapping content inside the sandboxed iframe.
// Links to Assets (images, etc.) and external/absolute/in-page links are left
// untouched so they resolve relative to the content origin as before.

import { guardRegexInput } from "../util/safe-regex.js";

export interface RewriteLinkOptions {
  /** Site-relative path of the Page being served, e.g. "guide/intro.md". */
  pagePath: string;
  /** All Markdown Page paths in this Version (for membership tests). */
  pagePaths: Set<string>;
  /** Viewer SPA base URL, e.g. "http://localhost:5173". */
  viewerBase: string;
  /** Site slug. */
  slug: string;
}

const ANCHOR_RE = /<a\b([^>]*?)\shref="([^"]*)"([^>]*)>/gi;

export function rewriteInterPageLinks(html: string, opts: RewriteLinkOptions): string {
  // Input-length guard: rendered HTML for a single Page should not exceed 1 MB.
  guardRegexInput(html, 1_000_000);
  const slash = opts.pagePath.lastIndexOf("/");
  const dir = slash === -1 ? "" : opts.pagePath.slice(0, slash);

  return html.replace(ANCHOR_RE, (match, pre, href, post) => {
    const target = resolveRelative(dir, href);
    if (target === null || !opts.pagePaths.has(target)) return match;
    const newHref = `${opts.viewerBase}/s/${opts.slug}/${target}`;
    return `<a${pre} href="${newHref}"${post} target="_top" rel="noopener">`;
  });
}

// Resolve a relative href against the current Page's directory, returning the
// normalized Site-relative Page path — or null for anything not an in-Site
// relative link (absolute URL, scheme, root-relative, or bare fragment).
function resolveRelative(dir: string, href: string): string | null {
  if (
    href === "" ||
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(href)
  ) {
    return null;
  }

  const pathPart = href.split(/[?#]/, 1)[0]!;
  if (pathPart === "") return null;

  const out = dir === "" ? [] : dir.split("/");
  for (const seg of pathPart.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join("/");
}
