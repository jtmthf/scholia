import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { connectBridge, type Theme, type BridgeHandle } from "@collab/bridge";
import type { SelectionCandidate } from "@collab/core";
import {
  createConversation,
  fetchSite,
  listConversations,
  SiteNotFoundError,
  type AnchorInput,
  type ConversationDTO,
  type NavNode,
  type SiteMeta,
} from "./api";
import { ensureViewer, getViewer, setDisplayName } from "./viewer";
import { Rail } from "./comments/Rail";
import { Composer } from "./comments/Composer";
import "./comments/comments.css";

// /s/:slug or /s/:slug/<path> — path may contain slashes (e.g. guide/intro.md)
function parseRoute(): { slug: string | null; pagePath: string | null } {
  const m = window.location.pathname.match(/^\/s\/([^/]+)(?:\/(.*))?$/);
  if (!m) return { slug: null, pagePath: null };
  return {
    slug: decodeURIComponent(m[1]!),
    pagePath: m[2] ? m[2].split("/").map(decodeURIComponent).join("/") : null,
  };
}

function countFiles(nodes: NavNode[]): number {
  return nodes.reduce((n, node) => {
    if (node.type === "file") return n + 1;
    return n + countFiles(node.children ?? []);
  }, 0);
}

type SiteState =
  | { status: "loading" }
  | { status: "ready"; meta: SiteMeta }
  | { status: "missing" }
  | { status: "error"; message: string };

export function App() {
  const [route, setRoute] = useState(parseRoute);
  const [siteState, setSiteState] = useState<SiteState>({ status: "loading" });
  const { slug, pagePath } = route;

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!slug) {
      setSiteState({ status: "missing" });
      return;
    }
    setSiteState({ status: "loading" });
    let active = true;
    fetchSite(slug)
      .then((meta) => active && setSiteState({ status: "ready", meta }))
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof SiteNotFoundError) setSiteState({ status: "missing" });
        else
          setSiteState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (siteState.status === "loading") return <Centered>Loading…</Centered>;
  if (siteState.status === "missing")
    return (
      <Centered>
        <h1>Not found</h1>
        <p>There's no Site at this link, or it has been removed.</p>
      </Centered>
    );
  if (siteState.status === "error")
    return (
      <Centered>
        <h1>Something went wrong</h1>
        <p>{siteState.message}</p>
      </Centered>
    );

  const { meta } = siteState;
  const currentPath = pagePath ?? meta.entryPath;
  const currentPage = meta.pages.find((p) => p.path === currentPath);
  const pageTitle = currentPage?.title ?? currentPath;
  const showNav = countFiles(meta.nav) > 1;

  function navigate(path: string) {
    history.pushState(null, "", `/s/${encodeURIComponent(meta.slug)}/${path}`);
    setRoute({ slug: meta.slug, pagePath: path });
  }

  return (
    <div class="viewer">
      <header class="chrome">
        <span class="brand">collab</span>
        <span class="doc-title" title={pageTitle}>
          {pageTitle}
        </span>
        <span class="version">v{meta.version}</span>
      </header>
      <div class="body">
        {showNav && (
          <nav class="nav">
            <NavTree nodes={meta.nav} currentPath={currentPath} slug={meta.slug} onNavigate={navigate} />
          </nav>
        )}
        <PageView meta={meta} currentPath={currentPath} pageTitle={pageTitle} />
      </div>
    </div>
  );
}

function osTheme(): Theme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function candidateToAnchor(candidate: SelectionCandidate): AnchorInput {
  return {
    textQuote: candidate.quote,
    smIds: candidate.smIds,
    ...(candidate.xpath ? { xpath: candidate.xpath } : {}),
    ...(candidate.css ? { css: candidate.css } : {}),
  };
}

type ComposerState = { anchor: AnchorInput | null; at?: { left: number; top: number } };

// The content view (M5): the sandboxed cross-origin iframe (ADR-0003) plus the
// comment layer. allow-scripts gives uploaded pages interactivity, but with no
// allow-same-origin the content is an opaque origin that can't reach the app
// origin, its storage, or the API. The bridge carries theme (M4) and, in M5, the
// selection/anchor channel: selections become a floating "Comment" affordance and
// a new-Thread composer; stored Thread anchors are resolved+highlighted back in
// the frame; clicking a highlight focuses its Thread in the rail.
function PageView({
  meta,
  currentPath,
  pageTitle,
}: {
  meta: SiteMeta;
  currentPath: string;
  pageTitle: string;
}) {
  const slug = meta.slug;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<BridgeHandle | null>(null);
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [selection, setSelection] = useState<{ candidate: SelectionCandidate; rect: DOMRectInit } | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const reload = useCallback(() => {
    const viewer = getViewer(slug);
    listConversations(slug, currentPath, viewer?.viewerId ?? null)
      .then(setConversations)
      .catch(() => setConversations([]));
  }, [slug, currentPath]);

  const onNeedViewer = useCallback(async () => {
    const v = await ensureViewer(slug);
    return { viewerId: v.viewerId, displayName: v.displayName ?? "" };
  }, [slug]);

  // (Re)load Threads when the page changes.
  useEffect(() => {
    setConversations([]);
    setSelection(null);
    setComposer(null);
    setActiveThreadId(null);
    reload();
  }, [reload]);

  // Bridge lifecycle — recreated per page (the iframe reloads when src changes).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = connectBridge(iframe, {
      theme: osTheme(),
      onSelection: (e) => setSelection({ candidate: e.candidate, rect: e.rect }),
      onSelectionCleared: () => setSelection(null),
      onAnchorActivated: (id) => setActiveThreadId(id),
    });
    bridgeRef.current = bridge;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => bridge.setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [currentPath, slug]);

  // Resolve + highlight every anchored Thread whenever the set changes. Requests
  // issued before the iframe handshake are queued by the bridge and flushed on
  // ready, so this is safe to run immediately after load.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.clearAnchors();
    for (const c of conversations) {
      if (c.anchor) bridge.resolveAnchor(c.id, c.anchor.textQuote);
    }
  }, [conversations]);

  // Position the floating "Comment" button at the selection: the rect is in
  // iframe coordinates, so offset it by the iframe's position in the parent.
  const floatingPos = useMemo(() => {
    if (!selection) return null;
    const iframe = iframeRef.current;
    if (!iframe) return null;
    const box = iframe.getBoundingClientRect();
    const r = selection.rect;
    // DOMRectInit exposes x/y (== left/top for a normalized rect).
    return {
      left: box.left + (r.x ?? 0) + (r.width ?? 0) / 2,
      top: box.top + (r.y ?? 0),
    };
  }, [selection]);

  async function submitNewThread(body: string, displayName: string) {
    setSubmitting(true);
    setComposerError(null);
    try {
      const v = await ensureViewer(slug);
      if (displayName && !v.displayName) setDisplayName(slug, displayName);
      await createConversation(slug, {
        pagePath: currentPath,
        anchor: composer?.anchor ?? null,
        body,
        viewerId: v.viewerId,
        displayName: displayName || v.displayName || "Anonymous",
      });
      setComposer(null);
      setSelection(null);
      reload();
    } catch (err: unknown) {
      setComposerError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setSubmitting(false);
    }
  }

  const viewerName = getViewer(slug)?.displayName;

  return (
    <>
      <iframe
        ref={iframeRef}
        class="content"
        title={pageTitle}
        src={`${meta.contentBase}/${currentPath}`}
        sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation"
        referrerPolicy="no-referrer"
      />

      <Rail
        slug={slug}
        conversations={conversations}
        activeThreadId={activeThreadId}
        onNeedViewer={onNeedViewer}
        onChanged={reload}
        onActivateThread={(id) => {
          setActiveThreadId(id);
          bridgeRef.current?.scrollToAnchor(id);
        }}
        onNewPageComment={() => setComposer({ anchor: null })}
      />

      {selection && floatingPos && !composer && (
        <button
          class="floating-comment-btn"
          style={{ left: `${floatingPos.left}px`, top: `${floatingPos.top}px`, transform: "translate(-50%, -120%)" }}
          // Don't let the click steal focus / collapse anything before we read it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            setComposer({ anchor: candidateToAnchor(selection.candidate), at: floatingPos })
          }
        >
          💬 Comment
        </button>
      )}

      {composer && (
        <div
          class="floating-composer-panel"
          style={
            composer.at
              ? {
                  left: `${Math.max(8, Math.min(composer.at.left - 150, window.innerWidth - 320))}px`,
                  top: `${Math.min(composer.at.top + 12, window.innerHeight - 240)}px`,
                }
              : { right: "340px", top: "72px" }
          }
        >
          <Composer
            label={composer.anchor ? "New comment on selection" : "Comment on this page"}
            needsName={!viewerName}
            currentName={viewerName}
            isSubmitting={submitting}
            error={composerError}
            onSubmit={submitNewThread}
            onCancel={() => setComposer(null)}
          />
        </div>
      )}
    </>
  );
}

function NavTree({
  nodes,
  currentPath,
  slug,
  onNavigate,
}: {
  nodes: NavNode[];
  currentPath: string;
  slug: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <ul class="nav-list">
      {nodes.map((node) =>
        node.type === "dir" ? (
          <NavDir key={node.fsPath} node={node} currentPath={currentPath} slug={slug} onNavigate={onNavigate} />
        ) : (
          <NavFile key={node.fsPath} node={node} currentPath={currentPath} slug={slug} onNavigate={onNavigate} />
        ),
      )}
    </ul>
  );
}

function NavDir({
  node,
  currentPath,
  slug,
  onNavigate,
}: {
  node: NavNode;
  currentPath: string;
  slug: string;
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li class="nav-dir">
      <button class="nav-dir-toggle" onClick={() => setOpen((o) => !o)}>
        <span class="nav-dir-arrow">{open ? "▾" : "▸"}</span>
        {node.title}
      </button>
      {open && node.children && (
        <NavTree nodes={node.children} currentPath={currentPath} slug={slug} onNavigate={onNavigate} />
      )}
    </li>
  );
}

function NavFile({
  node,
  currentPath,
  slug,
  onNavigate,
}: {
  node: NavNode;
  currentPath: string;
  slug: string;
  onNavigate: (path: string) => void;
}) {
  const active = node.urlPath === currentPath;
  return (
    <li class="nav-file">
      <a
        class={`nav-link${active ? " nav-link--active" : ""}`}
        href={`/s/${encodeURIComponent(slug)}/${node.urlPath}`}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(node.urlPath);
        }}
      >
        {node.title}
      </a>
    </li>
  );
}

function Centered({ children }: { children: ComponentChildren }) {
  return <div class="centered">{children}</div>;
}
