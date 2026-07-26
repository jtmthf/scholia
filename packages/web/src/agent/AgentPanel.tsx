import { useEffect, useState } from "preact/hooks";
import { API_BASE } from "../api";
import "./agent.css";

interface AgentPanelProps {
  slug: string;
  token: string;
  onClose: () => void;
}

export function AgentPanel({ slug, token, onClose }: AgentPanelProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/agent-prompt`, {
          headers: { Authorization: `Bearer ${token}` },
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
  }, [slug, token]);

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
          <span class="agent-panel-title">Agent prompt</span>
          <button class="agent-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div class="agent-panel-warning">
          <strong>Owner-only — do not share with human reviewers.</strong> Human reviewers receive
          the Share URL. This prompt contains the owner token which grants full write access; paste
          it only into a trusted agent environment.
        </div>

        {error ? (
          <div class="composer-error">{error}</div>
        ) : (
          <textarea
            class="agent-panel-prompt"
            readOnly
            value={prompt ?? "Loading prompt…"}
            rows={prompt ? prompt.split("\n").length + 2 : 8}
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
