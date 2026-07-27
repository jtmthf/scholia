import "./app.css";

// ---- Theme (dark mode) ----
function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function mermaidTheme(): "dark" | "default" {
  return isDark() ? "dark" : "default";
}

// ---- Mermaid (lazy-loaded; the bundle is large and most pages have no diagrams) ----
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function getMermaid() {
  if (!mermaidPromise) mermaidPromise = import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

async function renderMermaid(): Promise<void> {
  const blocks = Array.from(document.querySelectorAll<HTMLElement>("pre.mermaid"));
  if (blocks.length === 0) return;
  const mermaid = await getMermaid();
  for (const block of blocks) {
    // Stash the original source once; mermaid destroys it on render.
    if (!block.dataset.src) block.dataset.src = block.textContent ?? "";
    block.removeAttribute("data-processed");
    block.innerHTML = block.dataset.src ?? "";
  }
  mermaid.initialize({ startOnLoad: false, theme: mermaidTheme() });
  // suppressErrors: a malformed diagram renders an error box instead of throwing.
  await mermaid.run({ nodes: blocks, suppressErrors: true });
}

// ---- Copy-code buttons ----
function addCopyButtons(): void {
  for (const pre of Array.from(document.querySelectorAll<HTMLElement>("pre.shiki"))) {
    if (pre.querySelector(".copy-btn")) continue;
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
      void navigator.clipboard
        ?.writeText(code)
        .then(() => {
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1500);
        })
        .catch(() => {});
    });
    pre.appendChild(btn);
  }
}

// ---- Outline scrollspy ----
let outlineObserver: IntersectionObserver | null = null;

function initScrollSpy(): void {
  outlineObserver?.disconnect();
  outlineObserver = null;

  const links = new Map<string, HTMLAnchorElement>();
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(".outline a"))) {
    const id = decodeURIComponent((a.getAttribute("href") ?? "").replace(/^#/, ""));
    if (id) links.set(id, a);
  }
  if (links.size === 0) return;

  const heads = Array.from(
    document.querySelectorAll<HTMLElement>(".markdown-body h2[id], .markdown-body h3[id]"),
  ).filter((h) => links.has(h.id));
  if (heads.length === 0) return;

  const visible = new Set<string>();
  const setActive = (id: string | undefined): void => {
    for (const [hid, a] of links) a.classList.toggle("active", hid === id);
  };

  outlineObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add((e.target as HTMLElement).id);
        else visible.delete((e.target as HTMLElement).id);
      }
      // Highlight the first heading currently in view; otherwise the last one
      // scrolled past (so the active item is never blank mid-section).
      let active = heads.find((h) => visible.has(h.id))?.id;
      if (!active) {
        const top = window.scrollY + 100;
        for (const h of heads) if (h.offsetTop <= top) active = h.id;
      }
      setActive(active);
    },
    { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
  );
  for (const h of heads) outlineObserver.observe(h);
}

// Every page-action button is wired this way: delegated on `document` rather
// than bound per-element, so it survives the live-reload page-header swap
// without needing re-init.
function onButtonClick(selector: string, handler: (btn: HTMLButtonElement) => void): void {
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const btn = e.target.closest<HTMLButtonElement>(selector);
    if (!btn || btn.disabled) return;
    handler(btn);
  });
}

// ---- Open in editor (ADR-0017) ----
// The button only exists when the server's startup probe found an editor, so
// this is purely click wiring — no capability check on the client.
function initOpenInEditor(): void {
  onButtonClick("#scholia-open-editor", (btn) => {
    const path = btn.dataset.path;
    if (!path) return;

    const original = btn.textContent ?? "Open in editor";
    const failed = () => {
      btn.textContent = "Couldn't open";
      setTimeout(() => (btn.textContent = original), 1500);
    };

    btn.disabled = true;
    fetch("/__open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then((res) => res.json().catch(() => ({ ok: false })))
      .then((data: { ok?: boolean }) => {
        if (!data.ok) failed();
      })
      .catch(failed)
      .finally(() => {
        btn.disabled = false;
      });
  });
}

// Copy `text`, flashing "Copied" on the button and restoring its label.
function copyWithFeedback(btn: HTMLButtonElement, text: string): void {
  const original = btn.textContent ?? "";
  void navigator.clipboard
    ?.writeText(text)
    .then(() => {
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = original), 1500);
    })
    .catch(() => {});
}

// ---- Copy markdown ----
// The raw source is embedded server-side (`#scholia-source-md`, a JSON string
// so entities never need decoding) — reused here rather than a fetch, since
// the server already read it to render the page.
function initCopyMarkdown(): void {
  onButtonClick("#scholia-copy-md", (btn) => {
    const raw = document.getElementById("scholia-source-md")?.textContent ?? "";
    let source: string;
    try {
      source = JSON.parse(raw);
    } catch {
      return;
    }

    copyWithFeedback(btn, source);
  });
}

// ---- Copy path (ADR-0017) ----
// Rendered in place of "Open in editor" when no editor resolved at startup:
// the absolute path is still the thing the user wants, and pasting it into
// their own editor works everywhere.
function initCopyPath(): void {
  onButtonClick("#scholia-copy-path", (btn) => {
    const path = btn.dataset.path;
    if (path) copyWithFeedback(btn, path);
  });
}

// ---- Mobile navigation drawer ----
function initNav(): void {
  document.getElementById("scholia-menu-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("nav-open");
  });
  // Delegated so it survives nav-pane replacement on live reload.
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest(".nav-backdrop") || e.target.closest(".nav-pane a")) {
      document.body.classList.remove("nav-open");
    }
  });
}

function setTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("scholia-theme", dark ? "dark" : "light");
  } catch {
    /* ignore */
  }
  void renderMermaid();
}

function initTheme(): void {
  const toggle = document.getElementById("scholia-theme-toggle");
  toggle?.addEventListener("click", () => setTheme(!isDark()));
}

// ---- Live reload (scroll-preserving content swap, falling back to full reload) ----
async function liveReloadSwap(): Promise<void> {
  try {
    const res = await fetch(location.href, { headers: { "x-scholia-livereload": "1" } });
    if (!res.ok) return location.reload();
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");

    const fresh = doc.querySelector(".markdown-body");
    const current = document.querySelector(".markdown-body");
    if (!fresh || !current) return location.reload();

    // Replace content in place so the window scroll position is preserved.
    current.innerHTML = fresh.innerHTML;
    document.title = doc.title;

    for (const sel of [
      ".outline",
      ".nav-pane",
      ".page-header",
      ".colophon",
      "#scholia-source-md",
    ]) {
      const next = doc.querySelector(sel);
      const prev = document.querySelector(sel);
      if (next && prev) prev.replaceWith(next);
    }

    addCopyButtons();
    initScrollSpy();
    await renderMermaid();
  } catch {
    location.reload();
  }
}

function connectLiveReload(): void {
  const source = new EventSource("/__livereload");
  source.addEventListener("message", (event) => {
    if (event.data === "reload") void liveReloadSwap();
  });
  // EventSource auto-reconnects on error; nothing to do.
}

// ---- Search ----
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Escape first, then wrap query-term occurrences in <mark>.
function highlight(text: string, query: string): string {
  const escaped = escapeHtml(text);
  const terms = query.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (terms.length === 0) return escaped;
  return escaped.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>");
}

interface Hit {
  path: string;
  title: string;
  snippet: string;
}

function initSearch(): void {
  const input = document.getElementById("scholia-search") as HTMLInputElement | null;
  const results = document.getElementById("scholia-search-results");
  if (!input || !results) return;

  let timer: ReturnType<typeof setTimeout>;
  let active = -1; // index of the keyboard-highlighted result, -1 = none

  const items = (): HTMLAnchorElement[] =>
    Array.from(results.querySelectorAll<HTMLAnchorElement>("a"));

  function setActive(next: number): void {
    const links = items();
    if (links.length === 0) return;
    // Wrap around so Up from the top lands on the last item and vice versa.
    active = (next + links.length) % links.length;
    links.forEach((a, i) => a.classList.toggle("active", i === active));
    links[active]?.scrollIntoView({ block: "nearest" });
  }

  function close(): void {
    results!.hidden = true;
    active = -1;
  }

  async function run(): Promise<void> {
    const q = input!.value.trim();
    active = -1;
    if (!q) {
      results!.hidden = true;
      results!.innerHTML = "";
      return;
    }
    try {
      const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
      const hits = (await res.json()) as Hit[];
      results!.hidden = false;
      results!.innerHTML = hits.length
        ? hits
            .map(
              (h) =>
                `<a href="${escapeHtml(h.path)}"><span class="t">${highlight(
                  h.title,
                  q,
                )}</span><span class="s">${highlight(h.snippet, q)}</span></a>`,
            )
            .join("")
        : `<div class="empty">No results</div>`;
    } catch {
      close();
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 150);
  });

  // Pointer hover keeps the keyboard highlight in sync with the mouse.
  results.addEventListener("mousemove", (e) => {
    if (!(e.target instanceof Element)) return;
    const link = e.target.closest("a");
    if (!link) return;
    const idx = items().indexOf(link);
    if (idx !== -1 && idx !== active) setActive(idx);
  });

  // Arrow keys move the selection; Enter opens it; Escape dismisses.
  input.addEventListener("keydown", (e) => {
    if (results.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === "Enter") {
      const links = items();
      const target = links[active] ?? links[0];
      if (target) {
        e.preventDefault();
        window.location.assign(target.href);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      input.blur();
    }
  });

  // Cmd/Ctrl-K focuses search.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Node)) return;
    if (!input.contains(e.target) && !results.contains(e.target)) close();
  });
}

// ---- Boot ----
connectLiveReload();
initTheme();
initNav();
initSearch();
initOpenInEditor();
initCopyPath();
initCopyMarkdown();
addCopyButtons();
initScrollSpy();
void renderMermaid();
