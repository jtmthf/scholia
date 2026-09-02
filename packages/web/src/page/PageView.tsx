import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CommentsProvider, Rail, type CommentsPort, type ConversationDTO } from "@scholia/ui";
import type { SiteMeta } from "../api.js";
import { useChats, useConversations } from "../data/queries.js";
import { useCommentsPort } from "../data/comments-port.js";
import { useHydrated } from "../data/hydrated.js";
import { useViewer } from "../data/identity.js";
import { sitePath } from "../routes.js";
import { NewConversationComposer, type DraftConversation } from "./NewConversationComposer.js";
import { SelectionActions } from "./SelectionActions.js";
import { candidateToAnchor, useContentBridge } from "./use-content-bridge.js";

// A stable empty list: the anchor-highlight effect keys off list identity, so a
// fresh `[]` per render would re-resolve every Anchor on every render.
const NONE: ConversationDTO[] = [];

// The port the server renders through: every Conversation, and nothing that
// writes (issue #111, ADR-0038). One shared instance, so the render before
// hydration is identical every time.
const READ_ONLY_PORT: CommentsPort = { displayName: null, canModerate: false };

interface PageViewProps {
  site: SiteMeta;
  currentPath: string;
  pageTitle: string;
  /** A pinned historical Version: content only, no comment layer. */
  readOnly: boolean;
  ownerToken: string | null;
  onBringAgent: () => void;
}

/**
 * One Page: the sandboxed content iframe (ADR-0003) and the comment layer over it.
 *
 * `allow-scripts` keeps uploaded Pages interactive, but without `allow-same-origin`
 * the content is an opaque origin that can't reach the app origin, its storage, or
 * the API — so everything between the two sides goes through the bridge.
 */
export function PageView({
  site,
  currentPath,
  pageTitle,
  readOnly,
  ownerToken,
  onBringAgent,
}: PageViewProps) {
  const slug = site.slug;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewer = useViewer(slug);
  const viewerId = viewer?.viewerId ?? null;

  // Comments live on Latest, so a historical view fetches none (CONTEXT "Latest").
  const conversations = useConversations(slug, currentPath, viewerId, !readOnly).data ?? NONE;
  const chats = useChats(slug, currentPath, viewerId, !readOnly).data ?? NONE;

  // Both public Threads and the reader's own Chats highlight in the frame (a Chat
  // Anchor grounds their agent, CONTEXT "Chat"). Only live Anchors resolve against
  // the current Version; Outdated ones live in the rail with a permalink instead.
  const anchored = useMemo(
    () =>
      [...conversations, ...chats].filter((c) => c.anchor !== null && c.anchorStatus === "live"),
    [conversations, chats],
  );

  const bridge = useContentBridge({
    iframeRef,
    pageKey: `${slug}:${currentPath}`,
    readOnly,
    anchored,
  });

  // Until this tree has hydrated there is no Viewer and no Owner token to act
  // with, so the rail is handed a port that can only read and renders as the
  // reading surface it is — rather than a full set of controls that silently do
  // nothing (issue #111, ADR-0038). The entry points the *rail* owns go the same
  // way: starting a Page Comment and minting an agent token are both writes.
  const hydrated = useHydrated();
  const livePort = useCommentsPort(slug, currentPath, ownerToken);
  const port = hydrated ? livePort : READ_ONLY_PORT;
  const [draft, setDraft] = useState<DraftConversation | null>(null);
  const selection = bridge.selection;

  // A new Page is a clean slate for anything half-composed.
  useEffect(() => setDraft(null), [slug, currentPath]);

  const content = (
    <iframe
      ref={iframeRef}
      class="content"
      title={pageTitle}
      src={`${site.contentBase}/${currentPath}`}
      sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation"
      referrerPolicy="no-referrer"
    />
  );

  // A read-only historical Version: content only. The banner + "Go to Latest"
  // affordance is rendered by the shell.
  if (readOnly) return content;

  return (
    <>
      {content}

      <CommentsProvider value={port}>
        <Rail
          conversations={conversations}
          chats={chats}
          activeConversationId={bridge.activeConversationId}
          onActivate={bridge.activate}
          onEmphasize={bridge.emphasize}
          onNewPageComment={hydrated ? () => setDraft({ anchor: null, mode: "thread" }) : undefined}
          onBringAgent={hydrated ? onBringAgent : undefined}
          outdatedOrigin={outdatedOrigin(slug)}
          outdatedNote="These Threads no longer match the Latest Version."
          pageLevelComposer={
            draft && !draft.anchor ? (
              <NewConversationComposer
                inline
                slug={slug}
                pagePath={currentPath}
                draft={draft}
                displayName={viewer?.displayName ?? null}
                onDone={() => setDraft(null)}
                onCancel={() => setDraft(null)}
              />
            ) : undefined
          }
        />
      </CommentsProvider>

      {selection && !draft && (
        <SelectionActions
          at={selection.at}
          onComment={() =>
            setDraft({
              anchor: candidateToAnchor(selection.candidate),
              at: selection.at,
              mode: "thread",
              quote: selection.candidate.quote.exact,
            })
          }
          onAsk={() =>
            setDraft({
              anchor: candidateToAnchor(selection.candidate),
              at: selection.at,
              mode: "chat",
              quote: selection.candidate.quote.exact,
            })
          }
        />
      )}

      {draft && draft.anchor && (
        <NewConversationComposer
          slug={slug}
          pagePath={currentPath}
          draft={draft}
          displayName={viewer?.displayName ?? null}
          onDone={() => {
            setDraft(null);
            bridge.clearSelection();
          }}
          onCancel={() => setDraft(null)}
        />
      )}
    </>
  );
}

/**
 * An Outdated Conversation links back to the Version it was written on, so the
 * reader can see what the passage used to say (CONTEXT "Outdated").
 */
function outdatedOrigin(slug: string) {
  return (c: ConversationDTO) =>
    c.createdOrdinal === undefined
      ? null
      : {
          href: sitePath(slug, c.pagePath, c.createdOrdinal),
          label: `from v${c.createdOrdinal} ↗`,
        };
}
