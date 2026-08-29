import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { connectBridge, type BridgeHandle, type Theme } from "@scholia/bridge";
import type { SelectionCandidate } from "@scholia/core";
import type { AnchorInput } from "../api.js";
import type { ConversationDTO } from "@scholia/ui";

function osTheme(): Theme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The bridge's selection candidate in the shape the API takes for a new Anchor. */
export function candidateToAnchor(candidate: SelectionCandidate): AnchorInput {
  return {
    textQuote: candidate.quote,
    smIds: candidate.smIds,
    ...(candidate.xpath ? { xpath: candidate.xpath } : {}),
    ...(candidate.css ? { css: candidate.css } : {}),
  };
}

export interface ContentSelection {
  candidate: SelectionCandidate;
  /** Where to float the affordance, already translated into parent coordinates. */
  at: { left: number; top: number };
}

export interface ContentBridge {
  /** The reader's current selection inside the content, or null. */
  selection: ContentSelection | null;
  clearSelection: () => void;
  /** The Conversation whose card is highlighted in the rail. */
  activeConversationId: string | null;
  /** Focus a Conversation and scroll its Anchor into view in the content. */
  activate: (id: string) => void;
  /** Emphasize a Conversation's passage (hovering its rail card), or clear with null. */
  emphasize: (id: string | null) => void;
}

/**
 * Everything that crosses the iframe boundary, in one place.
 *
 * The content is a sandboxed cross-origin document (ADR-0003), so none of this is a
 * DOM query — it's a message channel: theme goes down, selections come up, Anchors
 * are resolved and highlighted on request, and a click on a highlight comes back as
 * a Conversation id. The handle is recreated per Page, because changing the iframe's
 * `src` reloads the document underneath it.
 */
export function useContentBridge(opts: {
  iframeRef: RefObject<HTMLIFrameElement>;
  /** Changes when the iframe navigates — the trigger to rebuild the channel. */
  pageKey: string;
  /** A pinned historical Version still gets theme, but no selection channel. */
  readOnly: boolean;
  /** Conversations to resolve + highlight; only live Anchors can match. */
  anchored: ConversationDTO[];
}): ContentBridge {
  const { iframeRef, pageKey, readOnly, anchored } = opts;
  const bridgeRef = useRef<BridgeHandle | null>(null);
  const [raw, setRaw] = useState<{ candidate: SelectionCandidate; rect: DOMRectInit } | null>(null);
  const [activeConversationId, setActive] = useState<string | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = connectBridge(iframe, {
      theme: osTheme(),
      onSelection: (e) => !readOnly && setRaw({ candidate: e.candidate, rect: e.rect }),
      onSelectionCleared: () => setRaw(null),
      // A click that missed every highlight arrives as null — clearing a stale
      // active card is exactly as valid a report as setting one (issue #109).
      onAnchorActivated: (id) => setActive(id),
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
  }, [iframeRef, pageKey, readOnly]);

  // Reset per-Page focus and selection when the content changes underneath.
  useEffect(() => {
    setRaw(null);
    setActive(null);
  }, [pageKey]);

  // (Re)highlight every anchored Conversation whenever the set changes. Requests
  // issued before the iframe handshake are queued by the bridge and flushed on
  // ready, so this is safe to run immediately after load.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.clearAnchors();
    for (const c of anchored) {
      if (c.anchor) bridge.resolveAnchor(c.id, c.anchor.textQuote, c.resolved);
    }
  }, [anchored]);

  // The rect arrives in iframe coordinates; offset it by the iframe's own position
  // so the floating affordance lands over the selection in the parent document.
  const selection = useMemo<ContentSelection | null>(() => {
    if (!raw) return null;
    const iframe = iframeRef.current;
    if (!iframe) return null;
    const box = iframe.getBoundingClientRect();
    const r = raw.rect;
    // DOMRectInit exposes x/y (== left/top for a normalized rect). Anchor
    // floating affordances at the bottom of the selection so they sit below the
    // passage instead of covering it (issue #106).
    return {
      candidate: raw.candidate,
      at: {
        left: box.left + (r.x ?? 0) + (r.width ?? 0) / 2,
        top: box.top + (r.y ?? 0) + (r.height ?? 0),
      },
    };
  }, [raw, iframeRef]);

  const activate = useCallback((id: string) => {
    setActive(id);
    bridgeRef.current?.scrollToAnchor(id);
  }, []);

  const emphasize = useCallback((id: string | null) => {
    bridgeRef.current?.emphasizeAnchor(id);
  }, []);

  const clearSelection = useCallback(() => setRaw(null), []);

  return { selection, clearSelection, activeConversationId, activate, emphasize };
}
