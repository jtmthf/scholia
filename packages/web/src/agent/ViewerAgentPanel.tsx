import { useEffect, useState } from "preact/hooks";
import { API_BASE, mintViewerAgentToken } from "../api";
import { ensureViewer } from "../viewer";
import "./agent.css";

interface ViewerAgentPanelProps {
  slug: string;
  onClose: () => void;
}

export function ViewerAgentPanel({ slug, onClose }: ViewerAgentPanelProps) {
  // Mint on open: ensure a Viewer exists (this is a deliberate action, so minting
  // is allowed here — viewer.ts contract), then mint/re-mint the agent token, then
  // fetch the server-generated prompt.
  const [prompt, setPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Step 1: Ensure viewer + mint token.
        const v = await ensureViewer(slug);
        const minted = await mintViewerAgentToken(slug, v.viewerId);

        // Step 2: Fetch the server-generated prompt using the newly minted token.
        const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/agent-prompt`, {
          headers: { Authorization: `Bearer ${minted.token}` },
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const text = await res.text();
        if (active) setPrompt(text);
      } catch (err: unknown) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load prompt.");
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  async function handleCopy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Clipboard API unavailable; user can manually select from the textarea below.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div class="agent-panel-backdrop" onClick={onClose}>
      <div class="agent-panel" onClick={(e) => e.stopPropagation()}>
        <div class="agent-panel-header">
          <span class="agent-panel-title">Bring your agent</span>
          <button class="agent-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div class="agent-panel-warning">
          <strong>This is your personal agent handoff.</strong> The token grants your agent read
          access, your own private Chats, and public commenting on this Site — but{" "}
          <strong>no Owner powers</strong> (it can't delete the Site, rotate links, or manage other
          people's comments). Paste it only into a trusted agent environment.
        </div>

        {error ? (
          <div class="composer-error">{error}</div>
        ) : (
          <textarea
            class="agent-panel-prompt"
            readOnly
            value={prompt ?? "Minting your agent token…"}
            rows={prompt ? prompt.split("\n").length + 2 : 9}
            onFocus={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        )}

        <div class="agent-panel-footer">
          <button
            class={`btn-primary agent-panel-copy${copied ? " agent-panel-copy--copied" : ""}`}
            disabled={!prompt}
            onClick={() => void handleCopy()}
          >
            {copied ? "Copied!" : "Copy agent prompt"}
          </button>
          <a
            class="agent-panel-docs-link"
            href={`${API_BASE}/agent-docs`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Agent docs ↗
          </a>
        </div>
      </div>
    </div>
  );
}
