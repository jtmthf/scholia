import { escapeHtml } from "@collab/core";
import { iframeBridgeScript } from "@collab/bridge";

// Styles for the content document served into the sandboxed iframe. A trimmed
// version of Local Preview's reading-view CSS (packages/local app.css) covering
// just the rendered-markdown body, Shiki's dual-theme CSS variables, GitHub
// alerts, and tables — no Collab chrome (that lives in the parent viewer).
const CONTENT_CSS = `
:root {
  --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de;
  --link: #0969da; --code-bg: #f6f8fa;
}
html.dark {
  --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d;
  --link: #4493f8; --code-bg: #161b22;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 16px; line-height: 1.6;
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 32px 24px 80px; }
.markdown-body > *:first-child { margin-top: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin: 1.6em 0 0.6em; line-height: 1.25; font-weight: 600;
}
.markdown-body h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.markdown-body h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h1 a, .markdown-body h2 a, .markdown-body h3 a,
.markdown-body h4 a, .markdown-body h5 a, .markdown-body h6 a { color: inherit; }
.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote { margin: 0 0 1em; }
.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li { margin: 0.25em 0; }
.markdown-body blockquote { padding: 0 1em; color: var(--muted); border-left: 0.25em solid var(--border); }
.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9em; background: var(--code-bg); padding: 0.2em 0.4em; border-radius: 6px;
}
.markdown-body pre { margin: 0 0 1em; }
.markdown-body pre code { background: none; padding: 0; font-size: 0.875em; }
.markdown-body img { max-width: 100%; }
.markdown-body table { border-collapse: collapse; display: block; overflow-x: auto; margin: 0 0 1em; }
.markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 6px 13px; }
.markdown-body tr:nth-child(2n) { background: var(--code-bg); }
.markdown-body hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
.markdown-body .task-list-item { list-style: none; }
.markdown-body .task-list-item input { margin: 0 0.5em 0 -1.4em; }
.shiki {
  background-color: var(--shiki-light-bg) !important;
  padding: 16px; border-radius: 8px; overflow-x: auto; border: 1px solid var(--border);
}
.shiki, .shiki span { color: var(--shiki-light); }
html.dark .shiki { background-color: var(--shiki-dark-bg) !important; }
html.dark .shiki, html.dark .shiki span { color: var(--shiki-dark); }
.markdown-alert { padding: 8px 16px; margin: 0 0 1em; border-left: 0.25em solid var(--alert-color, var(--border)); }
.markdown-alert > :first-child { margin-top: 0; }
.markdown-alert > :last-child { margin-bottom: 0; }
.markdown-alert-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--alert-color, var(--fg)); margin-bottom: 4px; }
.markdown-alert-title svg { fill: currentColor; }
.markdown-alert-note { --alert-color: #0969da; }
.markdown-alert-tip { --alert-color: #1a7f37; }
.markdown-alert-important { --alert-color: #8250df; }
.markdown-alert-warning { --alert-color: #9a6700; }
.markdown-alert-caution { --alert-color: #cf222e; }
`.trim();

// Wrap a rendered Markdown Page fragment into a standalone HTML document for the
// content origin. This is what loads inside the sandboxed cross-origin iframe
// (ADR-0003); the `data-sm` stamps in the fragment survive for M5 anchoring. The
// injected bridge script (M4) performs the handshake, applies the parent's theme
// (OS preference until then), and reports content height.
export function renderContentDocument(fragmentHtml: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>${CONTENT_CSS}</style>
</head>
<body>
<article class="markdown-body">${fragmentHtml}</article>
<script>${iframeBridgeScript()}</script>
</body>
</html>`;
}

// Prepare an HTML Page's served document for the content origin (M4, ADR-0003).
// The page's own markup/styles/scripts are preserved as-is (already `data-sm`-
// stamped at ingest); we only inject a `noindex` meta and the iframe bridge
// script. parse5's serialized output is always a full document, so the
// `</head>`/`</body>` anchors exist; the fallbacks cover hand-rolled fragments.
export function prepareHtmlDocument(servedHtml: string): string {
  let html = servedHtml;
  const meta = `<meta name="robots" content="noindex" />`;
  const script = `<script>${iframeBridgeScript()}</script>`;

  if (!/^\s*<!doctype/i.test(html)) html = `<!doctype html>\n${html}`;

  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${meta}</head>`);
  else if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => `${m}${meta}`);
  else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${meta}</head>`);
  else html = `${meta}${html}`;

  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${script}</body>`);
  else html += script;

  return html;
}
