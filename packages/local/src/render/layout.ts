import { escapeHtml, type Heading, type NavNode } from "@collab/core";

export interface LayoutOptions {
  title: string;
  contentHtml: string;
  headings: Heading[];
  nav: NavNode[];
  currentPath: string;
  showSidebar: boolean;
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

function renderToc(headings: Heading[]): string {
  const usable = headings.filter((h) => h.depth >= 2 && h.depth <= 3);
  if (usable.length === 0) return "";
  const items = usable
    .map(
      (h) =>
        `<li class="toc-h${h.depth}"><a href="#${escapeHtml(h.id)}">${escapeHtml(
          h.text,
        )}</a></li>`,
    )
    .join("");
  return `<nav class="toc" aria-label="On this page"><div class="toc-title">On this page</div><ul>${items}</ul></nav>`;
}

export function renderPage(opts: LayoutOptions): string {
  const sidebar = opts.showSidebar
    ? `<aside class="sidebar"><nav class="nav" aria-label="Documents">${renderNav(
        opts.nav,
        opts.currentPath,
      )}</nav></aside><div class="nav-backdrop"></div>`
    : "";

  const menuToggle = opts.showSidebar
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
<body class="${opts.showSidebar ? "has-sidebar" : ""}">
<header class="topbar">
  <div class="topbar-inner">
    ${menuToggle}
    <span class="brand">${escapeHtml(opts.title)}</span>
    <div class="search">
      <input id="collab-search" type="search" placeholder="Search docs…" autocomplete="off" spellcheck="false">
      <div id="collab-search-results" class="search-results" hidden></div>
    </div>
    <button id="collab-theme-toggle" class="theme-toggle" type="button" aria-label="Toggle dark mode">◐</button>
  </div>
</header>
<div class="layout">
${sidebar}
<main class="content">
<article class="markdown-body">
${opts.contentHtml}
</article>
</main>
${renderToc(opts.headings)}
</div>
<script type="module" src="/__assets/client.js"></script>
</body>
</html>`;
}
