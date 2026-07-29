import type { VNode } from "preact";
import { render } from "preact-render-to-string";
import type { Heading, NavNode, Provenance } from "@scholia/core";

export interface ColophonInfo {
  /** File path relative to the served root, e.g. "docs/adr/0016-....md". */
  relPath: string;
  mtimeMs: number;
  provenance?: Provenance;
}

export interface LayoutOptions {
  title: string;
  contentHtml: string;
  headings: Heading[];
  nav: NavNode[];
  currentPath: string;
  showNav: boolean;
  /** Project identity for the topbar — the served root's directory name. */
  rootName: string;
  /** From the once-at-startup editor probe (ADR-0017) — "Copy path" replaces the button when false. */
  editorAvailable: boolean;
  /** Absolute filesystem path of this Page's source file — the payload for "Copy path". */
  filePath: string;
  /** Raw source text for the "Copy markdown" button, embedded to avoid a fetch round-trip. */
  sourceMarkdown: string;
  /** Null for non-doc / error pages that have no meaningful Colophon. */
  colophon: ColophonInfo | null;
}

// Inline pre-paint script: apply the saved/system theme before first paint to
// avoid a flash of the wrong color scheme.
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('scholia-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

// Interleave a separator between siblings without reusing one VNode instance
// across slots — `separator` is a factory, not a node.
function joinWith(items: VNode[], separator: () => VNode): VNode[] {
  return items.flatMap((item, i) => (i === 0 ? [item] : [separator(), item]));
}

function NavSubtitle({ subtitle }: { subtitle: string | undefined }) {
  return subtitle ? <span class="nav-subtitle">{subtitle}</span> : null;
}

function Nav({ nodes, currentPath }: { nodes: NavNode[]; currentPath: string }) {
  if (nodes.length === 0) return null;
  return (
    <ul>
      {nodes.map((node) =>
        node.type === "dir" ? (
          <li class="nav-dir" key={node.urlPath}>
            <span class="nav-dir-label">
              {node.title}
              <NavSubtitle subtitle={node.subtitle} />
            </span>
            <Nav nodes={node.children ?? []} currentPath={currentPath} />
          </li>
        ) : (
          <li key={node.urlPath}>
            <a href={node.urlPath} class={node.urlPath === currentPath ? "active" : undefined}>
              <span class="nav-label">{node.title}</span>
              <NavSubtitle subtitle={node.subtitle} />
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

function Outline({ headings }: { headings: Heading[] }) {
  const usable = headings.filter((h) => h.depth >= 2 && h.depth <= 3);
  if (usable.length === 0) return null;
  return (
    <nav class="outline" aria-label="Outline">
      <div class="outline-title">Outline</div>
      <ul>
        {usable.map((h) => (
          <li class={`outline-h${h.depth}`} key={h.id}>
            <a href={`#${h.id}`}>{h.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Local Preview has full filesystem-path knowledge a hosted Viewer
// structurally can't have (ADR-0017's reasoning for /__open applies here
// too) — the breadcrumb is derived straight from the URL path rather than
// carried as separate state. Directory segments link to that directory's
// Entry Page; the final segment (the current Page) is plain text.
function Breadcrumb({ currentPath }: { currentPath: string }) {
  const segments = currentPath.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1]!.replace(/\.(md|markdown|mdx|html?)$/i, "");

  let acc = "";
  const crumbs = segments.slice(0, -1).map((seg) => {
    acc += `/${seg}`;
    return (
      <a href={`${acc}/`} key={acc}>
        {seg}
      </a>
    );
  });
  crumbs.push(<span class="crumb-current">{last}</span>);

  return (
    <nav class="breadcrumb" aria-label="Breadcrumb">
      {joinWith(crumbs, () => (
        <span class="crumb-sep">/</span>
      ))}
    </nav>
  );
}

function PageActions({
  editorAvailable,
  relPath,
  filePath,
}: Pick<LayoutOptions, "editorAvailable" | "filePath"> & { relPath: string }) {
  return (
    <div class="page-actions">
      {/* No editor resolved at startup: "Copy path" takes the slot rather than a
          button that fails on click (ADR-0017). The affordance degrades; it never
          breaks, and the user is never told why — detection is deliberately silent. */}
      {editorAvailable ? (
        <button id="scholia-open-editor" class="btn" type="button" data-path={relPath}>
          Open in editor
        </button>
      ) : (
        <button id="scholia-copy-path" class="btn" type="button" data-path={filePath}>
          Copy path
        </button>
      )}
      <button id="scholia-copy-md" class="btn" type="button">
        Copy markdown
      </button>
    </div>
  );
}

// CONTEXT "Colophon": path, mtime, Provenance — a provenance record, not
// part of the reading path, so it sits after the article rather than above
// it. Quiet, small text (ADR-0016) — it must not compete with the article.
function Colophon({ info }: { info: ColophonInfo | null }) {
  if (!info) return null;
  const mtime = new Date(info.mtimeMs)
    .toISOString()
    .replace("T", " ")
    .replace(/:\d\d\.\d+Z$/, " UTC");

  const parts: VNode[] = [
    <span class="colophon-path">{info.relPath}</span>,
    <span class="colophon-mtime">edited {mtime}</span>,
  ];
  const p = info.provenance;
  if (p?.branch && p.sha) {
    parts.push(
      <span class="colophon-provenance">
        {p.branch} @ {p.sha.slice(0, 7)}
        {p.dirty ? ", uncommitted changes" : ""}
      </span>,
    );
  }

  return (
    <footer class="colophon">
      {joinWith(parts, () => (
        <span class="colophon-sep">·</span>
      ))}
    </footer>
  );
}

// Embeds the raw source as a JSON string inside a non-executing script tag
// so "Copy markdown" reuses what the server already read for rendering,
// rather than adding a fetch round-trip. `<` is escaped so neither a
// "</script>" nor a "<!--" in the source can affect HTML parsing — which is
// also why this is raw HTML rather than a JSX text child: the escaping here
// has to be JSON's, not the view layer's.
function SourceScript({ source }: { source: string }) {
  const json = JSON.stringify(source).replace(/</g, "\\u003c");
  return (
    <script
      type="application/json"
      id="scholia-source-md"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

function Document(opts: LayoutOptions) {
  const relPath = opts.colophon?.relPath ?? opts.currentPath.replace(/^\/+/, "");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{opts.title}</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="stylesheet" href="/__assets/katex/katex.min.css" />
        <link rel="stylesheet" href="/__assets/client.css" />
      </head>
      <body class={opts.showNav ? "has-nav" : ""}>
        <header class="topbar">
          <div class="topbar-inner">
            {opts.showNav && (
              <button
                id="scholia-menu-toggle"
                class="menu-toggle"
                type="button"
                aria-label="Toggle navigation"
              >
                ☰
              </button>
            )}
            <span class="brand">{opts.rootName}</span>
            <div class="search">
              <input
                id="scholia-search"
                type="search"
                placeholder="Search docs…"
                autocomplete="off"
                spellcheck={false}
              />
              <div id="scholia-search-results" class="search-results" hidden />
            </div>
            <button
              id="scholia-theme-toggle"
              class="theme-toggle"
              type="button"
              aria-label="Toggle dark mode"
            >
              ◐
            </button>
          </div>
        </header>
        <div class="layout">
          {opts.showNav && (
            <>
              <aside class="nav-pane">
                <nav class="nav" aria-label="Documents">
                  <Nav nodes={opts.nav} currentPath={opts.currentPath} />
                </nav>
              </aside>
              <div class="nav-backdrop" />
            </>
          )}
          <main class="content">
            <div class="page-header">
              <Breadcrumb currentPath={opts.currentPath} />
              <h1 class="page-title">{opts.title}</h1>
              <PageActions
                editorAvailable={opts.editorAvailable}
                filePath={opts.filePath}
                relPath={relPath}
              />
            </div>
            {/* Content HTML comes from the shared render pipeline already
                escaped; it is inserted verbatim, never re-encoded here. */}
            <article class="markdown-body" dangerouslySetInnerHTML={{ __html: opts.contentHtml }} />
            <Colophon info={opts.colophon} />
          </main>
          <Outline headings={opts.headings} />
        </div>
        <SourceScript source={opts.sourceMarkdown} />
        <script type="module" src="/__assets/client.js" />
      </body>
    </html>
  );
}

// SSR only (ADR-0011): the chrome is server-rendered and shipped as finished
// HTML. Nothing here hydrates — `client.js` wires the handful of interactive
// controls by delegation against the DOM the server sent, so first paint never
// waits on JS. `preact-render-to-string` emits no doctype, so we prepend one.
export function renderPage(opts: LayoutOptions): string {
  return `<!doctype html>\n${render(<Document {...opts} />)}`;
}
