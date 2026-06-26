import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { connectBridge, type Theme } from "@collab/bridge";
import { fetchSite, SiteNotFoundError, type NavNode, type SiteMeta } from "./api";

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
        <ContentFrame src={`${meta.contentBase}/${currentPath}`} title={pageTitle} />
      </div>
    </div>
  );
}

function osTheme(): Theme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// The sandboxed cross-origin content iframe (ADR-0003) plus the parent end of
// the bridge (M4). allow-scripts gives uploaded pages interactivity, but there
// is no allow-same-origin, so the content is an opaque origin that can't reach
// the app origin, its storage, or the API.
// allow-top-navigation-by-user-activation lets rewritten inter-page links
// navigate the top frame to the viewer route (keeping the chrome). The bridge
// pushes the chrome's theme into the frame over postMessage.
function ContentFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const bridge = connectBridge(iframe, { theme: osTheme() });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => bridge.setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      bridge.dispose();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      class="content"
      title={title}
      src={src}
      sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation"
      referrerPolicy="no-referrer"
    />
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
