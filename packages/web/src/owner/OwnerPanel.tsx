import { useState } from "preact/hooks";
import {
  deleteSite as apiDeleteSite,
  rotateOwnerToken,
  rotateShare,
  setSiteState,
  type SiteState,
} from "../api";
import "../agent/agent.css";
import "./owner-panel.css";

// The owner moderation & ops panel (M9). Owner-only — gated by the presence of an
// owner token in the caller. Exposes Site state, Share URL rotation, owner token
// rotation, and Site deletion. Rotations/deletion mutate the owner's own
// localStorage state, so the parent handles the follow-through (re-key the token,
// navigate to the new slug, or leave the deleted Site) via callbacks.
interface OwnerPanelProps {
  slug: string;
  token: string;
  state: SiteState;
  onClose: () => void;
  onStateChanged: (state: SiteState) => void;
  onShareRotated: (slug: string, shareUrl: string) => void;
  onTokenRotated: (token: string) => void;
  onDeleted: () => void;
}

const STATES: { value: SiteState; label: string; hint: string }[] = [
  { value: "open", label: "Open", hint: "Read + public comment" },
  { value: "read_only", label: "Read-only", hint: "Viewing open, public commenting off" },
  { value: "frozen", label: "Frozen", hint: "Public Threads locked" },
];

export function OwnerPanel({
  slug,
  token,
  state,
  onClose,
  onStateChanged,
  onShareRotated,
  onTokenRotated,
  onDeleted,
}: OwnerPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newShareUrl, setNewShareUrl] = useState<string | null>(null);
  const [newAgentUrl, setNewAgentUrl] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function changeState(next: SiteState) {
    if (next === state) return;
    const res = await run(`state:${next}`, () => setSiteState(slug, token, next));
    if (res) onStateChanged(res.state);
  }

  async function doRotateShare() {
    const res = await run("share", () => rotateShare(slug, token));
    if (res) {
      setNewShareUrl(res.shareUrl);
      onShareRotated(res.slug, res.shareUrl);
    }
  }

  async function doRotateToken() {
    const res = await run("token", () => rotateOwnerToken(slug, token));
    if (res) {
      setNewAgentUrl(res.agentUrl);
      onTokenRotated(res.token);
    }
  }

  async function doDelete() {
    const res = await run("delete", async () => {
      await apiDeleteSite(slug, token);
      return true;
    });
    if (res) onDeleted();
  }

  return (
    <div class="agent-panel-backdrop" onClick={onClose}>
      <div class="agent-panel owner-panel" onClick={(e) => e.stopPropagation()}>
        <div class="agent-panel-header">
          <span class="agent-panel-title">Manage Site</span>
          <button class="agent-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <div class="owner-panel-error">{error}</div>}

        <section class="owner-section">
          <h3 class="owner-section-title">Site state</h3>
          <div class="owner-state-options">
            {STATES.map((s) => (
              <button
                key={s.value}
                class={`owner-state-btn${state === s.value ? " owner-state-btn--active" : ""}`}
                disabled={busy !== null}
                onClick={() => changeState(s.value)}
              >
                <span class="owner-state-label">{s.label}</span>
                <span class="owner-state-hint">{s.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section class="owner-section">
          <h3 class="owner-section-title">Access</h3>
          <div class="owner-action-row">
            <div class="owner-action-copy">
              <strong>Rotate Share URL</strong>
              <span>Invalidate a leaked link and mint a fresh one.</span>
            </div>
            <button class="btn-secondary" disabled={busy !== null} onClick={doRotateShare}>
              {busy === "share" ? "…" : "Rotate"}
            </button>
          </div>
          {newShareUrl && <div class="owner-panel-notice">New Share URL: {newShareUrl}</div>}

          <div class="owner-action-row">
            <div class="owner-action-copy">
              <strong>Rotate owner token</strong>
              <span>Revoke the current token / Agent URL and issue a new one.</span>
            </div>
            <button class="btn-secondary" disabled={busy !== null} onClick={doRotateToken}>
              {busy === "token" ? "…" : "Rotate"}
            </button>
          </div>
          {newAgentUrl && (
            <div class="owner-panel-notice">
              New Agent URL minted — keep it secret. Reopen the Agent panel to copy the full prompt.
            </div>
          )}
        </section>

        <section class="owner-section owner-section--danger">
          <h3 class="owner-section-title">Danger zone</h3>
          <div class="owner-action-row">
            <div class="owner-action-copy">
              <strong>Delete this Site</strong>
              <span>Permanently removes every Version, comment, and Chat. Irreversible.</span>
            </div>
            {confirmDelete ? (
              <div class="owner-confirm">
                <button class="btn-danger" disabled={busy !== null} onClick={doDelete}>
                  {busy === "delete" ? "Deleting…" : "Confirm delete"}
                </button>
                <button class="btn-secondary" disabled={busy !== null} onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button class="btn-danger" disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
