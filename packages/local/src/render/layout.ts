import { escapeHtml, type Heading, type NavNode } from "@collab/core";

export interface LayoutOptions {
  title: string;
  contentHtml: string;
  headings: Heading[];
  nav: NavNode[];
  currentPath: string;
  showNav: boolean;
  /** Project identity for the topbar — the served root's directory name. */
  rootName: string;
  /** Raw source text for the "Copy markdown" button, embedded to avoid a fetch round-trip. */
  sourceMarkdown: string;
}

// Inline pre-paint script: apply the saved/system theme before first paint to
// avoid a flash of the wrong color scheme.
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('collab-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

function renderNav(nodes: NavNode[], currentPath: string): string {
  if (nodes.length === 0) return "";
  const items = nodes
    .map((node) => {
      if (node.type === "dir") {
        return `<li class="nav-dir"><span class="nav-dir-label">${escapeHtml(
          node.title,
        )}</span>${renderNav(node.children ?? [], currentPath)}</li>`;
      }
      const active = node.urlPath === currentPath ? " class=\"active\"" : "";
      return `<li><a href="${escapeHtml(node.urlPath)}"${active}>${escapeHtml(
        node.title,
      )}</a></li>`;
    })
    .join("");
  return `<ul>${items}</ul>`;
}

function renderOutline(headings: Heading[]): string {
  const usable = headings.filter((h) => h.depth >= 2 && h.depth <= 3);
  if (usable.length === 0) return "";
  const items = usable
    .map(
      (h) =>
        `<li class="outline-h${h.depth}"><a href="#${escapeHtml(h.id)}">${escapeHtml(
          h.text,
        )}</a></li>`,
    )
    .join("");
  return `<nav class="outline" aria-label="Outline"><div class="outline-title">Outline</div><ul>${items}</ul></nav>`;
}

// Local Preview has full filesystem-path knowledge a hosted Viewer
// structurally can't have (ADR-0017's reasoning for /__open applies here
// too) — the breadcrumb is derived straight from the URL path rather than
// carried as separate state. Directory segments link to that directory's
// Entry Page; the final segment (the current Page) is plain text.
function renderBreadcrumb(currentPath: string): string {
  const segments = currentPath.split("/").filter(Boolean);
  if (segments.length === 0) return "";
  const last = segments[segments.length - 1]!.replace(/\.(md|markdown|mdx|html?)$/i, "");
  const dirs = segments.slice(0, -1);

  let acc = "";
  const crumbs: string[] = [];
  for (const seg of dirs) {
    acc += `/${seg}`;
    crumbs.push(`<a href="${escapeHtml(acc + "/")}">${escapeHtml(seg)}</a>`);
  }
  crumbs.push(`<span class="crumb-current">${escapeHtml(last)}</span>`);
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${crumbs.join(
    '<span class="crumb-sep">/</span>',
  )}</nav>`;
}

function renderPageActions(): string {
  return `<div class="page-actions"><button id="collab-copy-md" class="btn" type="button">Copy markdown</button></div>`;
}

// Embeds the raw source as a JSON string inside a non-executing script tag
// so "Copy markdown" reuses what the server already read for rendering,
// rather than adding a fetch round-trip. `<` is escaped so neither a
// "</script>" nor a "<!--" in the source can affect HTML parsing.
function renderSourceScript(source: string): string {
  const json = JSON.stringify(source).replace(/</g, "\\u003c");
  return `<script type="application/json" id="collab-source-md">${json}</script>`;
}

export function renderPage(opts: LayoutOptions): string {
  const navPane = opts.showNav
    ? `<aside class="nav-pane"><nav class="nav" aria-label="Documents">${renderNav(
        opts.nav,
        opts.currentPath,
      )}</nav></aside><div class="nav-backdrop"></div>`
    : "";

  const menuToggle = opts.showNav
    ? `<button id="collab-menu-toggle" class="menu-toggle" type="button" aria-label="Toggle navigation">☰</button>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<script>${THEME_BOOT}</script>
<link rel="stylesheet" href="/__assets/katex/katex.min.css">
<link rel="stylesheet" href="/__assets/client.css">
</head>
<body class="${opts.showNav ? "has-nav" : ""}">
<header class="topbar">
  <div class="topbar-inner">
    ${menuToggle}
    <span class="brand">${escapeHtml(opts.rootName)}</span>
    <div class="search">
      <input id="collab-search" type="search" placeholder="Search docs…" autocomplete="off" spellcheck="false">
      <div id="collab-search-results" class="search-results" hidden></div>
    </div>
    <button id="collab-theme-toggle" class="theme-toggle" type="button" aria-label="Toggle dark mode">◐</button>
  </div>
</header>
<div class="layout">
${navPane}
<main class="content">
<div class="page-header">
  ${renderBreadcrumb(opts.currentPath)}
  <h1 class="page-title">${escapeHtml(opts.title)}</h1>
  ${renderPageActions()}
</div>
<article class="markdown-body">
${opts.contentHtml}
</article>
</main>
${renderOutline(opts.headings)}
</div>
${renderSourceScript(opts.sourceMarkdown)}
<script type="module" src="/__assets/client.js"></script>
</body>
</html>`;
}
