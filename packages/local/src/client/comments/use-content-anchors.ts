// Everything that happens in the content DOM, in one place.
//
// This is Local Preview's answer to the hosted viewer's `use-content-bridge`,
// and the difference is the whole point: hosted, the content is a sandboxed
// cross-origin document reached over postMessage (ADR-0003); locally it is an
// element in this same document, so selections are read and Anchors are painted
// directly. The capture and highlighting rules are the shared ones either way
// (@scholia/bridge's ./dom), so an Anchor means the same thing on both paths.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { AnchorHighlights, captureSelection, type SelectionCandidate } from "@scholia/bridge";
import type { ConversationDTO } from "@scholia/ui";

/**
 * Where to put something that floats over the content. Viewport coordinates,
 * because every floating affordance in the comment layer is `position: fixed`.
 */
export interface ViewportPoint {
  left: number;
  top: number;
}

export interface ContentSelection {
  candidate: SelectionCandidate;
  at: ViewportPoint;
}

export interface ContentAnchors {
  selection: ContentSelection | null;
  clearSelection: () => void;
  activeConversationId: string | null;
  /** Focus a Conversation and scroll its Anchor into view. */
  activate: (id: string) => void;
  /**
   * Where each resolved Anchor sits in the document, keyed by Conversation id.
   * The rail orders its cards by this so a Conversation is beside the passage it
   * is about rather than in the order it happened to be written.
   */
  anchorOffsets: Record<string, number>;
}

// A selection is captured a beat after the reader stops, so a drag doesn't fire
// on every intermediate range.
const CAPTURE_DEBOUNCE_MS = 30;

export function useContentAnchors(opts: {
  /** The element holding the Page's rendered content. */
  content: Element | null;
  /** Changes when the content is replaced (navigation, live reload). */
  contentKey: string;
  conversations: ConversationDTO[];
}): ContentAnchors {
  const { content, contentKey, conversations } = opts;
  const highlightsRef = useRef<AnchorHighlights | null>(null);
  const [selection, setSelection] = useState<ContentSelection | null>(null);
  const [activeConversationId, setActive] = useState<string | null>(null);
  const [anchorOffsets, setAnchorOffsets] = useState<Record<string, number>>({});

  // Watch the reader's selection over the content.
  useEffect(() => {
    if (!content) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const capture = (): void => {
      const captured = captureSelection(content, window.getSelection());
      if (!captured) {
        setSelection(null);
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      setSelection({
        candidate: captured.candidate,
        at: { left: rect.left + rect.width / 2, top: rect.top },
      });
    };

    const schedule = (): void => {
      clearTimeout(timer);
      timer = setTimeout(capture, CAPTURE_DEBOUNCE_MS);
    };

    document.addEventListener("selectionchange", schedule);
    document.addEventListener("mouseup", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("mouseup", schedule);
    };
  }, [content]);

  // Rebuild the highlighter whenever the content element is replaced — the old
  // one holds Ranges into a DOM that no longer exists.
  useEffect(() => {
    if (!content) return;
    highlightsRef.current = new AnchorHighlights(content);
    setSelection(null);
    setActive(null);
    return () => {
      highlightsRef.current?.clear();
      highlightsRef.current = null;
    };
  }, [content, contentKey]);

  // Paint every live Anchor onto the passage it belongs to.
  //
  // *Whether* an Anchor still resolves is the server's answer, not this one: it
  // re-resolves against the rendered text on every read, through the same
  // `migrateAnchor` the hosted path runs, so both paths call one Conversation
  // Outdated on exactly the same evidence (ADR-0029, issue #30). Deciding it a
  // second time here — against a tolerant DOM matcher, on markup that may be a
  // render behind what the server just read — would be a second answer to a
  // question that already has one, and the rail would show whichever arrived last.
  //
  // So an Outdated Conversation is left unpainted, and the highlight is what a
  // live one gets. A quote that fails to resolve in the DOM despite the server
  // finding it simply has no offset, and its card keeps its place at the end.
  useEffect(() => {
    const highlights = highlightsRef.current;
    if (!highlights) return;
    highlights.clear();
    const offsets: Record<string, number> = {};
    for (const conversation of conversations) {
      if (!conversation.anchor || conversation.anchorStatus !== "live") continue;
      if (highlights.resolve(conversation.id, conversation.anchor.textQuote)) {
        offsets[conversation.id] = highlights.offsetTop(conversation.id);
      }
    }
    setAnchorOffsets(offsets);
  }, [conversations, content, contentKey]);

  // Clicking a painted Anchor focuses its card, the same gesture the hosted
  // viewer reports over the bridge as `anchor-activated`.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const id = highlightsRef.current?.hitTest(e.clientX, e.clientY);
      if (id) setActive(id);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const activate = useCallback((id: string) => {
    setActive(id);
    highlightsRef.current?.scrollTo(id);
  }, []);

  const clearSelection = useCallback(() => setSelection(null), []);

  return {
    selection,
    clearSelection,
    activeConversationId,
    activate,
    anchorOffsets,
  };
}
