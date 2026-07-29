import type { SiteMeta } from "../api.js";

interface ChromeProps {
  site: SiteMeta;
  pageTitle: string;
  /** Present only for the Owner — gates the owner-only affordances (ADR-0005). */
  ownerToken: string | null;
  onToggleAgentPanel: () => void;
  onToggleOwnerPanel: () => void;
}

// The viewer's title bar: what you're reading, which Version, and — for the Owner
// alone — the way into the Agent Prompt and Site management.
export function Chrome({
  site,
  pageTitle,
  ownerToken,
  onToggleAgentPanel,
  onToggleOwnerPanel,
}: ChromeProps) {
  const pinned = !site.isLatest;
  return (
    <header class="chrome">
      <span class="brand">scholia</span>
      <span class="doc-title" title={pageTitle}>
        {pageTitle}
      </span>
      <span class={`version${pinned ? " version--pinned" : ""}`}>
        v{site.version}
        {pinned ? ` of ${site.latestVersion}` : ""}
      </span>
      {site.mirrorBinding && (
        <a
          class="pr-badge"
          href={`https://github.com/${site.mirrorBinding.repo}/pull/${site.mirrorBinding.prNumber}`}
          target="_blank"
          rel="noopener noreferrer"
          title="View on GitHub"
        >
          {site.mirrorBinding.repo}#{site.mirrorBinding.prNumber}
        </a>
      )}
      {ownerToken && (
        <>
          <button
            class="agent-prompt-btn"
            onClick={onToggleAgentPanel}
            title="Copy agent prompt (owner only)"
          >
            Agent
          </button>
          <button
            class="agent-prompt-btn"
            onClick={onToggleOwnerPanel}
            title="Manage Site (owner only)"
          >
            Manage
          </button>
        </>
      )}
      {ownerToken && site.state !== "open" && (
        <span class={`site-state-badge site-state-badge--${site.state}`}>
          {site.state === "frozen" ? "Frozen" : "Read-only"}
        </span>
      )}
    </header>
  );
}
