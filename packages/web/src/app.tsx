import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { connectBridge, type Theme, type BridgeHandle } from "@collab/bridge";
import type { SelectionCandidate } from "@collab/core";
import {
  createChat,
  createConversation,
  fetchSite,
  fetchSummary,
  listChats,
  listConversations,
  recordLastSeen,
  SiteNotFoundError,
  type AnchorInput,
  type ConversationDTO,
  type NavNode,
  type SiteMeta,
  type ViewerSummary,
} from "./api";
import { ensureViewer, getViewer, setDisplayName } from "./viewer";
import { getOwnerToken, setOwnerToken } from "./owner";
import { AgentPanel } from "./agent/AgentPanel";
import { ViewerAgentPanel } from "./agent/ViewerAgentPanel";
import { Rail } from "./comments/Rail";
import { Composer } from "./comments/Composer";
import { DiffPanel } from "./versioning/DiffPanel";
import "./comments/comments.css";
import "./versioning/versioning.css";
import "./agent/agent.css";

// /s/:slug or /s/:slug/<path> — path may contain slashes (e.g. guide/intro.md).
// `?v=<ordinal>` pins a historical Version (read-only permalink, CONTEXT "Latest").
function parseRoute(): { slug: string | null; pagePath: string | null; version: number | null } {
  const m = window.location.pathname.match(/^\/s\/([^/]+)(?:\/(.*))?$/);
  if (!m) return { slug: null, pagePath: null, version: null };
  const vRaw = new URLSearchParams(window.location.search).get("v");
  const v = vRaw !== null ? Number(vRaw) : NaN;
  return {
    slug: decodeURIComponent(m[1]!),
    pagePath: m[2] ? m[2].split("/").map(decodeURIComponent).join("/") : null,
    version: Number.isInteger(v) && v >= 1 ? v : null,
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
  const { slug, pagePath, version } = route;

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
    fetchSite(slug, version ?? undefined)
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
  }, [slug, version]);

  // "New since last visit" (CONTEXT "Last Seen Version") — site-level, so it
  // lives here (full-width banner) rather than in the per-Page view. Only for a
  // Viewer that already exists (never minted eagerly, viewer.ts contract) and only
  // on the Latest view (`?v=` pins skip it). After capturing counts against the
  // OLD Last Seen, advance it to Latest (server defaults to Latest).
  const [summary, setSummary] = useState<ViewerSummary | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [showViewerAgentPanel, setShowViewerAgentPanel] = useState(false);

  // Detect ?token= in the Agent URL (ADR-0005), persist to localStorage, and
  // strip from the address bar so it doesn't linger in history.
  const [siteOwnerToken, setSiteOwnerToken] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) {
      setSiteOwnerToken(null);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      setOwnerToken(slug, urlToken);
      params.delete("token");
      const qs = params.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    setSiteOwnerToken(getOwnerToken(slug));
  }, [slug]);

  useEffect(() => {
    setSummary(null);
    setShowDiff(false);
    if (!slug || version !== null) return;
    const viewer = getViewer(slug);
    if (!viewer) return;
    let active = true;
    fetchSummary(slug, viewer.viewerId)
      .then((s) => {
        if (!active) return;
        setSummary(s);
        return recordLastSeen(slug, viewer.viewerId);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [slug, version]);

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
  const readOnly = !meta.isLatest;
  // Preserve a pinned `?v=` across in-Site navigation (permalink stays historical).
  const vSuffix = readOnly ? `?v=${meta.version}` : "";
  const diffFrom = summary?.lastSeenVersion ?? null;
  const hasNews =
    !readOnly &&
    summary !== null &&
    diffFrom !== null &&
    (summary.newVersions > 0 || summary.newComments > 0);

  function navigate(path: string) {
    history.pushState(null, "", `/s/${encodeURIComponent(meta.slug)}/${path}${vSuffix}`);
    setRoute({ slug: meta.slug, pagePath: path, version: readOnly ? meta.version : null });
  }

  function goLatest() {
    history.pushState(null, "", `/s/${encodeURIComponent(meta.slug)}/${currentPath}`);
    setRoute({ slug: meta.slug, pagePath: currentPath, version: null });
  }

  return (
    <div class="viewer">
      <header class="chrome">
        <span class="brand">collab</span>
        <span class="doc-title" title={pageTitle}>
          {pageTitle}
        </span>
        <span class={`version${readOnly ? " version--pinned" : ""}`}>
          v{meta.version}
          {readOnly ? ` of ${meta.latestVersion}` : ""}
        </span>
        {siteOwnerToken && (
          <button
            class="agent-prompt-btn"
            onClick={() => setShowAgentPanel((v) => !v)}
            title="Copy agent prompt (owner only)"
          >
            Agent
          </button>
        )}
      </header>
      {showAgentPanel && siteOwnerToken && (
        <AgentPanel
          slug={meta.slug}
          token={siteOwnerToken}
          onClose={() => setShowAgentPanel(false)}
        />
      )}
      {showViewerAgentPanel && (
        <ViewerAgentPanel slug={meta.slug} onClose={() => setShowViewerAgentPanel(false)} />
      )}
      {readOnly && (
        <div class="version-banner version-banner--historical">
          <span>
            You're viewing <strong>Version {meta.version}</strong> — not the Latest (v
            {meta.latestVersion}). This is a read-only snapshot.
          </span>
          <button class="version-banner-action" onClick={goLatest}>
            Go to Latest
          </button>
        </div>
      )}
      {hasNews && summary && (
        <div class="version-banner version-banner--news">
          <span>
            {summary.newVersions > 0 && (
              <strong>
                {summary.newVersions} new Version{summary.newVersions === 1 ? "" : "s"}
              </strong>
            )}
            {summary.newVersions > 0 && summary.newComments > 0 && " · "}
            {summary.newComments > 0 && (
              <strong>
                {summary.newComments} new comment{summary.newComments === 1 ? "" : "s"}
              </strong>
            )}{" "}
            since your last visit.
          </span>
          {summary.newVersions > 0 && (
            <button class="version-banner-action" onClick={() => setShowDiff(true)}>
              View changes
            </button>
          )}
        </div>
      )}
      {showDiff && diffFrom !== null && (
        <DiffPanel
          slug={meta.slug}
          from={diffFrom}
          to={meta.latestVersion}
          onClose={() => setShowDiff(false)}
        />
      )}
      <div class="body">
        {showNav && (
          <nav class="nav">
            <NavTree nodes={meta.nav} currentPath={currentPath} slug={meta.slug} onNavigate={navigate} />
          </nav>
        )}
        <PageView
          meta={meta}
          currentPath={currentPath}
          pageTitle={pageTitle}
          readOnly={readOnly}
          onBringAgent={() => setShowViewerAgentPanel(true)}
        />
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

// A selection offers two actions: a public Thread ("Comment") or a private Chat
// ("Ask" your agent). The composer tracks which one it's authoring so submit
// routes to createConversation vs createChat and the labels adjust.
type ComposerMode = "thread" | "chat";
type ComposerState = {
  anchor: AnchorInput | null;
  mode: ComposerMode;
  at?: { left: number; top: number };
};

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
  readOnly,
  onBringAgent,
}: {
  meta: SiteMeta;
  currentPath: string;
  pageTitle: string;
  readOnly: boolean;
  onBringAgent: () => void;
}) {
  const slug = meta.slug;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<BridgeHandle | null>(null);
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [chats, setChats] = useState<ConversationDTO[]>([]);
  const [selection, setSelection] = useState<{ candidate: SelectionCandidate; rect: DOMRectInit } | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (readOnly) return;
    const viewer = getViewer(slug);
    listConversations(slug, currentPath, viewer?.viewerId ?? null)
      .then(setConversations)
      .catch(() => setConversations([]));
    // Only a Viewer that already exists can have Chats — never mint eagerly just
    // to check (viewer.ts contract). No Viewer ⇒ the Chats list is simply empty.
    if (viewer) {
      listChats(slug, currentPath, viewer.viewerId)
        .then(setChats)
        .catch(() => setChats([]));
    } else {
      setChats([]);
    }
  }, [slug, currentPath, readOnly]);

  const onNeedViewer = useCallback(async () => {
    const v = await ensureViewer(slug);
    return { viewerId: v.viewerId, displayName: v.displayName ?? "" };
  }, [slug]);

  // (Re)load Threads + Chats when the page changes.
  useEffect(() => {
    setConversations([]);
    setChats([]);
    setSelection(null);
    setComposer(null);
    setActiveThreadId(null);
    reload();
  }, [reload]);

  // Bridge lifecycle — recreated per page (the iframe reloads when src changes).
  // A read-only historical view still gets theme, but no selection→comment channel.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = connectBridge(iframe, {
      theme: osTheme(),
      onSelection: (e) => !readOnly && setSelection({ candidate: e.candidate, rect: e.rect }),
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
  }, [currentPath, slug, readOnly]);

  // Resolve + highlight every anchored Thread whenever the set changes. Requests
  // issued before the iframe handshake are queued by the bridge and flushed on
  // ready, so this is safe to run immediately after load.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.clearAnchors();
    // Both public Threads and the Viewer's own Chats highlight in the frame (a
    // Chat anchor grounds the Viewer's agent, CONTEXT "Chat").
    for (const c of [...conversations, ...chats]) {
      // Only live anchors resolve against the current Version; Outdated ones
      // live in the rail with a permalink instead (CONTEXT "Outdated").
      if (c.anchor && c.anchorStatus === "live") bridge.resolveAnchor(c.id, c.anchor.textQuote);
    }
  }, [conversations, chats]);

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

  async function submitNewConversation(body: string, displayName: string) {
    setSubmitting(true);
    setComposerError(null);
    try {
      const v = await ensureViewer(slug);
      if (displayName && !v.displayName) setDisplayName(slug, displayName);
      const input = {
        pagePath: currentPath,
        anchor: composer?.anchor ?? null,
        body,
        viewerId: v.viewerId,
        displayName: displayName || v.displayName || "Anonymous",
      };
      // Chat mode → a private Chat (visible only to this Viewer + its agents);
      // Thread mode → a public Thread. Same body otherwise.
      if (composer?.mode === "chat") await createChat(slug, input);
      else await createConversation(slug, input);
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

  // A read-only historical Version: content only, no comment layer (comments live
  // on Latest). The banner + "Go to Latest" affordance is rendered by App.
  if (readOnly) {
    return (
      <iframe
        ref={iframeRef}
        class="content"
        title={pageTitle}
        src={`${meta.contentBase}/${currentPath}`}
        sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation"
        referrerPolicy="no-referrer"
      />
    );
  }

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
        chats={chats}
        activeThreadId={activeThreadId}
        onNeedViewer={onNeedViewer}
        onChanged={reload}
        onActivateThread={(id) => {
          setActiveThreadId(id);
          bridgeRef.current?.scrollToAnchor(id);
        }}
        onNewPageComment={() => setComposer({ anchor: null, mode: "thread" })}
        onBringAgent={onBringAgent}
      />

      {selection && floatingPos && !composer && (
        <div
          class="floating-actions"
          style={{ left: `${floatingPos.left}px`, top: `${floatingPos.top}px`, transform: "translate(-50%, -120%)" }}
          // Don't let the click steal focus / collapse the selection before we read it.
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            class="floating-action-btn floating-comment-btn"
            onClick={() =>
              setComposer({ anchor: candidateToAnchor(selection.candidate), at: floatingPos, mode: "thread" })
            }
          >
            💬 Comment
          </button>
          <button
            class="floating-action-btn floating-ask-btn"
            onClick={() =>
              setComposer({ anchor: candidateToAnchor(selection.candidate), at: floatingPos, mode: "chat" })
            }
          >
            🔒 Ask
          </button>
        </div>
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
            label={
              composer.mode === "chat"
                ? "Ask your agent (private)"
                : composer.anchor
                  ? "New comment on selection"
                  : "Comment on this page"
            }
            placeholder={
              composer.mode === "chat"
                ? "Ask your agent about this selection…"
                : "Write a comment…"
            }
            submitLabel={composer.mode === "chat" ? "Ask" : "Comment"}
            needsName={!viewerName}
            currentName={viewerName}
            isSubmitting={submitting}
            error={composerError}
            onSubmit={submitNewConversation}
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
