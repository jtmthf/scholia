import { useEffect } from "preact/hooks";
import { useLocation } from "preact-iso";
import { useQueryClient } from "@tanstack/react-query";
import type { SiteMeta } from "../api.js";
import { clearOwnerToken, setOwnerToken } from "../owner.js";
import { queryKeys } from "../data/queries.js";
import { sitePath } from "../routes.js";
import { AgentPanel } from "../agent/AgentPanel.js";
import { ViewerAgentPanel } from "../agent/ViewerAgentPanel.js";
import { OwnerPanel } from "../owner/OwnerPanel.js";

/** Which overlay is open. At most one at a time, so one piece of state carries it. */
export type Panel = "agent" | "manage" | "viewer-agent";

interface OwnerPanelsProps {
  site: SiteMeta;
  version: number | null;
  ownerToken: string | null;
  open: Panel | null;
  onClose: () => void;
}

/**
 * The three overlays and — the reason they're worth their own module — the
 * consequences of what they do. Rotating the Share URL or the token re-keys a
 * credential in localStorage and moves the reader somewhere else; deleting the Site
 * invalidates the page they're on. That bookkeeping lives here rather than in the
 * shell's layout.
 */
export function OwnerPanels({ site, version, ownerToken, open, onClose }: OwnerPanelsProps) {
  const client = useQueryClient();
  const { route } = useLocation();

  return (
    <>
      {open === "agent" && ownerToken && (
        <AgentPanel slug={site.slug} token={ownerToken} onClose={onClose} />
      )}

      {open === "manage" && ownerToken && (
        <OwnerPanel
          slug={site.slug}
          token={ownerToken}
          state={site.state}
          mirrorBinding={site.mirrorBinding ?? null}
          githubAppSlug={site.githubAppSlug ?? null}
          onClose={onClose}
          // Patch the cached Site rather than refetching: the server already told
          // us the new state, and the reader is looking at the badge.
          onStateChanged={(state) =>
            client.setQueryData<SiteMeta>(queryKeys.site(site.slug, version), (prev) =>
              prev ? { ...prev, state } : prev,
            )
          }
          onShareRotated={(newSlug) => {
            // The old slug's link is dead; re-key the owner token under the new one
            // before navigating, or the Owner arrives without their credential.
            setOwnerToken(newSlug, ownerToken);
            clearOwnerToken(site.slug);
            onClose();
            route(sitePath(newSlug));
          }}
          onTokenRotated={(newToken) => setOwnerToken(site.slug, newToken)}
          onDeleted={() => {
            clearOwnerToken(site.slug);
            onClose();
            client.removeQueries({ queryKey: ["site", site.slug] });
            route("/");
          }}
        />
      )}

      {open === "viewer-agent" && <ViewerAgentPanel slug={site.slug} onClose={onClose} />}
    </>
  );
}

/**
 * An Owner arrives by Agent URL, which carries the token in the query string
 * (ADR-0005). Persist it, then strip it from the address bar so a full-capability
 * credential doesn't linger in history or get copied out of the URL bar.
 */
export function useOwnerTokenFromUrl(slug: string): void {
  const { query, route } = useLocation();
  const urlToken = query.token;

  useEffect(() => {
    if (!urlToken) return;
    setOwnerToken(slug, urlToken);
    const params = new URLSearchParams(query);
    params.delete("token");
    const qs = params.toString();
    route(`${location.pathname}${qs ? `?${qs}` : ""}`, true);
    // `query` is re-read on the next render; keying on the token alone is enough.
  }, [slug, urlToken]);
}
