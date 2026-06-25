import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fetchSite, SiteNotFoundError, type SiteMeta } from "./api";

// The Share URL shape (ADR-0005): /s/:slug. No token — read-only, public.
function slugFromPath(): string | null {
  const m = window.location.pathname.match(/^\/s\/([^/]+)\/?$/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

type ViewState =
  | { status: "loading" }
  | { status: "ready"; meta: SiteMeta }
  | { status: "missing" }
  | { status: "error"; message: string };

export function App() {
  const slug = slugFromPath();
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    if (!slug) {
      setState({ status: "missing" });
      return;
    }
    let active = true;
    fetchSite(slug)
      .then((meta) => active && setState({ status: "ready", meta }))
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof SiteNotFoundError) setState({ status: "missing" });
        else setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (state.status === "loading") return <Centered>Loading…</Centered>;
  if (state.status === "missing")
    return (
      <Centered>
        <h1>Not found</h1>
        <p>There's no Site at this link, or it has been removed.</p>
      </Centered>
    );
  if (state.status === "error")
    return (
      <Centered>
        <h1>Something went wrong</h1>
        <p>{state.message}</p>
      </Centered>
    );

  const { meta } = state;
  return (
    <div class="viewer">
      <header class="chrome">
        <span class="brand">collab</span>
        <span class="doc-title" title={meta.page.title}>
          {meta.page.title}
        </span>
        <span class="version">v{meta.version}</span>
      </header>
      {/* Page content runs cross-origin and sandboxed (ADR-0003): allow-scripts
          for interactivity, but no allow-same-origin, so it's an opaque origin
          that can't reach the app origin, its storage, or the API. */}
      <iframe
        class="content"
        title={meta.page.title}
        src={meta.page.contentUrl}
        sandbox="allow-scripts allow-popups"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

function Centered({ children }: { children: ComponentChildren }) {
  return <div class="centered">{children}</div>;
}
