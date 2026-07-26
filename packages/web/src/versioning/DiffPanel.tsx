import { useEffect, useState } from "preact/hooks";
import { fetchChangedPages, fetchPageDiff, type ChangedPage, type LineDiff } from "../api";

interface DiffPanelProps {
  slug: string;
  from: number;
  to: number;
  onClose: () => void;
}

// The Diff view (M6, CONTEXT "Diff"): a per-Page, source-level comparison between
// two Versions (default: Last Seen vs Latest). Lists the changed Pages; expanding
// one loads its line-level hunks. v1 does not overlay diffs on the rendered page.
export function DiffPanel({ slug, from, to, onClose }: DiffPanelProps) {
  const [pages, setPages] = useState<ChangedPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchChangedPages(slug, from, to)
      .then((r) => active && setPages(r.pages))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [slug, from, to]);

  return (
    <div class="diff-overlay" onClick={onClose}>
      <div class="diff-panel" onClick={(e) => e.stopPropagation()}>
        <header class="diff-header">
          <h2>
            Changes · v{from} → v{to}
          </h2>
          <button class="diff-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div class="diff-body">
          {error && <p class="diff-error">{error}</p>}
          {!error && pages === null && <p class="diff-loading">Loading changes…</p>}
          {pages !== null && pages.length === 0 && (
            <p class="diff-empty">No Pages changed between these Versions.</p>
          )}
          {pages?.map((p) => (
            <PageDiff key={p.path} slug={slug} from={from} to={to} page={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PageDiff({
  slug,
  from,
  to,
  page,
}: {
  slug: string;
  from: number;
  to: number;
  page: ChangedPage;
}) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<LineDiff | null>(null);
  const [loading, setLoading] = useState(false);

  // Assets have no source diff; render status only.
  const diffable = page.kind !== "asset" && page.status === "modified";

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && diffable && diff === null && !loading) {
      setLoading(true);
      fetchPageDiff(slug, from, to, page.path)
        .then((r) => setDiff(r.diff))
        .catch(() => setDiff({ lines: [], added: 0, removed: 0, unchanged: true }))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div class={`diff-file diff-file--${page.status}`}>
      <button class="diff-file-head" onClick={toggle} disabled={!diffable}>
        <span class={`diff-badge diff-badge--${page.status}`}>{page.status}</span>
        <span class="diff-file-path">{page.path}</span>
        {diffable && <span class="diff-file-arrow">{open ? "▾" : "▸"}</span>}
      </button>
      {open && diffable && (
        <div class="diff-hunks">
          {loading && <p class="diff-loading">Loading diff…</p>}
          {diff && (
            <table class="diff-table">
              <tbody>
                {diff.lines.map((l, i) => (
                  <tr key={i} class={`diff-line diff-line--${l.type}`}>
                    <td class="diff-gutter">{l.oldLine ?? ""}</td>
                    <td class="diff-gutter">{l.newLine ?? ""}</td>
                    <td class="diff-sign">
                      {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
                    </td>
                    <td class="diff-code">{l.text || " "}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
