import type { VNode } from "preact";
import { render } from "preact-render-to-string";
import type { Heading, NavNode, Provenance } from "@scholia/core";
import { CommentsProvider, Rail, type CommentsPort, type ConversationDTO } from "@scholia/ui";
import { CHATS_NOTE, EMPTY_NOTE, OUTDATED_NOTE, PROMOTE_NOTE } from "./comment-copy.js";
import { buildFormAction } from "./form-action.js";
import { splitByVisibility } from "../client/comments/visibility.js";

export interface CommentsInfo {
  /** Repo-relative path of the Page these Conversations are on. */
  pagePath: string;
  /** sha256 of the Source that produced this render — the Comment's binding. */
  contentHash: string;
  /** The author git config names, so the Composer never has to ask. */
  displayName: string;
  /**
   * Whether this reader is the Owner — the person at this machine (CONTEXT
   * "Owner"). Decided per request, because a Tunnel guest reaches the same
   * server: they may comment, but not delete other people's Conversations.
   */
  canModerate: boolean;
  conversations: ConversationDTO[];
}

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
  /**
   * An HTML Page's own `<style>`/`<link>` elements, hoisted into the head so the
   * Page looks the way its author built it. Empty for a Markdown Page.
   */
  pageStyles: string;
  /** Null for a page with nothing to comment on (a render error). */
  comments: CommentsInfo | null;
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

// The comment layer's server render (ADR-0030's @scholia/ui, ADR-0011's SSR).
//
// The rail is chrome like the Nav and the Outline: it is in the first response,
// finished, so Conversations are readable before any JavaScript runs. What the
// client adds is the parts that need a live DOM — selecting text, highlighting
// an Anchor, posting — by hydrating this exact markup.
//
// Every method Local Preview supplies in the browser is present here, rejecting,
// because @scholia/ui reads an absent method as "this surface doesn't have that
// affordance" — and a control the server left out would have to appear when the
// client hydrates, which is a rail that changes shape under the reader. The
// forms back the same verbs, so the markup is identical on both sides and
// hydration reshapes nothing (ADR-0034).
const inert = () => Promise.reject(new Error("not interactive until the page loads"));

function portFor(comments: CommentsInfo): CommentsPort {
  const conversationOf = (commentId: string): string => {
    const owner = comments.conversations.find((c) => c.comments.some((cm) => cm.id === commentId));
    if (!owner) throw new Error("That comment is no longer on this page. Reload and try again.");
    return owner.id;
  };

  const formAction: CommentsPort["formAction"] = (verb, id) =>
    buildFormAction(
      { pagePath: comments.pagePath, contentHash: comments.contentHash, conversationOf },
      verb,
      id,
    );

  return {
    displayName: comments.displayName,
    canModerate: comments.canModerate,
    addComment: inert,
    toggleReaction: inert,
    setResolved: inert,
    deleteConversation: inert,
    formAction,
    ...(comments.canModerate ? { editComment: inert, deleteComment: inert, promote: inert } : {}),
  };
}

// No `outdatedOrigin`: local files are live rather than snapshotted, so there is
// no earlier state an Outdated Conversation could link back to. The copy is
// shared with the client, which hydrates this markup — a string that differed
// between the two would be a correction the reader can see.
function CommentRail({ comments }: { comments: CommentsInfo }) {
  // The same split the hydrated island makes, from the same function: a rail
  // that divided Threads from Chats differently on the two sides would be a
  // correction the reader can see.
  const { threads, chats } = splitByVisibility(comments.conversations);
  return (
    <div id="scholia-comments">
      <CommentsProvider value={portFor(comments)}>
        <Rail
          conversations={threads}
          chats={chats}
          activeConversationId={null}
          onActivate={() => {}}
          onNewPageComment={() => {}}
          outdatedNote={OUTDATED_NOTE}
          emptyNote={EMPTY_NOTE}
          chatsNote={CHATS_NOTE}
          promoteNote={PROMOTE_NOTE}
        />
      </CommentsProvider>
    </div>
  );
}

// Embeds the raw source as a JSON string inside a non-executing script tag
// so "Copy markdown" reuses what the server already read for rendering,
// rather than adding a fetch round-trip. `<` is escaped so neither a
// "</script>" nor a "<!--" in the source can affect HTML parsing — which is
// also why this is raw HTML rather than a JSX text child: the escaping here
// has to be JSON's, not the view layer's.
function SourceScript({ source }: { source: string }) {
  return <JsonScript id="scholia-source-md" value={source} />;
}

// The comment layer's props, handed to the client as data rather than re-fetched
// — it is hydrating markup the server already rendered from these exact values,
// so fetching them again would be asking the same question twice and risking a
// different answer.
function CommentsScript({ comments }: { comments: CommentsInfo }) {
  return <JsonScript id="scholia-comments-data" value={comments} />;
}

// A JSON payload in a non-executing script tag. `<` is escaped so neither a
// "</script>" nor a "<!--" in the value can affect HTML parsing — which is also
// why this is raw HTML rather than a JSX text child: the escaping here has to be
// JSON's, not the view layer's.
function JsonScript({ id, value }: { id: string; value: unknown }) {
  const json = JSON.stringify(value).replace(/</g, "\\u003c");
  return <script type="application/json" id={id} dangerouslySetInnerHTML={{ __html: json }} />;
}

function HeadContent(opts: LayoutOptions) {
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{opts.title}</title>
      <link rel="icon" href="/__assets/favicon.svg" type="image/svg+xml" />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <link rel="stylesheet" href="/__assets/katex/katex.min.css" />
      <link rel="stylesheet" href="/__assets/client.css" />
    </>
  );
}

function Document(opts: LayoutOptions) {
  const relPath = opts.colophon?.relPath ?? opts.currentPath.replace(/^\/+/, "");

  // The head is rendered to a string and concatenated rather than composed as
  // children, because an HTML Page's own `<style>`/`<link>` elements arrive as
  // raw markup and `dangerouslySetInnerHTML` needs an element to sit on — and
  // that element would be a `<div>` in `<head>`, which the parser would move into
  // the body, taking the Page's styling with it.
  //
  // They come last, so the Page wins where it and the chrome disagree: it is the
  // Page the reader came to read. Which is also why an HTML Page can restyle the
  // chrome around it — locally the content is the reader's own and there is no
  // frame to contain it.
  const head = render(<HeadContent {...opts} />) + opts.pageStyles;

  return (
    <html lang="en">
      <head dangerouslySetInnerHTML={{ __html: head }} />
      <body
        class={[opts.showNav ? "has-nav" : "", opts.comments ? "has-comments" : ""]
          .filter(Boolean)
          .join(" ")}
      >
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
            {/* Two faces, one per theme, and CSS shows the one that matches
                (issue #114). The server has no way to know which theme is on —
                it is localStorage plus `prefers-color-scheme`, both read in the
                pre-paint script above — so a single server-rendered glyph and
                label could only ever describe one of the two. Each face carries
                its own accessible name, so the button is named for the theme it
                is in whether or not the client bundle ever boots; `aria-pressed`
                is added by `initTheme` in the client, which is also the only
                thing that makes the button do anything. */}
            <button id="scholia-theme-toggle" class="theme-toggle" type="button">
              <span class="theme-toggle-face theme-toggle-face--light">
                <span aria-hidden="true">☀</span>
                <span class="visually-hidden">Light theme</span>
              </span>
              <span class="theme-toggle-face theme-toggle-face--dark">
                <span aria-hidden="true">☾</span>
                <span class="visually-hidden">Dark theme</span>
              </span>
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
                escaped; it is inserted verbatim, never re-encoded here. It is
                also the surface a reader selects text on, so its `data-sm`
                stamps and the Page's content hash ride on the element itself. */}
            <article
              class="markdown-body"
              data-page-path={opts.comments?.pagePath}
              data-content-hash={opts.comments?.contentHash}
              dangerouslySetInnerHTML={{ __html: opts.contentHtml }}
            />
            <Colophon info={opts.colophon} />
          </main>
          <Outline headings={opts.headings} />
          {opts.comments && <CommentRail comments={opts.comments} />}
        </div>
        <SourceScript source={opts.sourceMarkdown} />
        {opts.comments && <CommentsScript comments={opts.comments} />}
        <script type="module" src="/__assets/client.js" />
      </body>
    </html>
  );
}

// Server-rendered in full (ADR-0011): the reading view — chrome, content,
// Colophon and the comment rail — is finished HTML in the first response, so
// first paint never waits on JS. `client.js` then wires the interactive controls
// by delegation, and hydrates exactly one island: the comment layer, which needs
// a live DOM to select text in and highlight Anchors against.
// `preact-render-to-string` emits no doctype, so we prepend one.
export function renderPage(opts: LayoutOptions): string {
  return `<!doctype html>\n${render(<Document {...opts} />)}`;
}
