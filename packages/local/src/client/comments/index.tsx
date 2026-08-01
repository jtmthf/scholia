// Mounting the comment layer onto the server-rendered page.
//
// The rail arrives as finished HTML, so the first mount is a `hydrate`, not a
// `render`: the markup stays exactly where it is and the layer attaches to it.
// That is what makes the comment layer the page's only hydration boundary —
// every other control is wired by delegation against the DOM the server sent
// (see ../main.ts).

import { hydrate, render } from "preact";
import { CommentLayer, type CommentsData } from "./CommentLayer.js";

const ROOT_ID = "scholia-comments";
const DATA_ID = "scholia-comments-data";
const CONTENT_SELECTOR = "article.markdown-body";

// Hydration happens once. A live reload swaps the data script and calls this
// again, and by then the rail is Preact's own output — patching it as a normal
// render is correct, and hydrating a second time would not be.
let hydrated = false;

function readData(): CommentsData | null {
  const raw = document.getElementById(DATA_ID)?.textContent;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CommentsData;
  } catch {
    return null;
  }
}

/**
 * Attach (or re-attach) the comment layer.
 *
 * Safe to call on a page that has none: a render error has no Page to comment
 * on, so the server sends no rail and there is nothing to mount.
 */
export function mountComments(): void {
  const root = document.getElementById(ROOT_ID);
  const data = readData();
  if (!root || !data) {
    hydrated = false;
    return;
  }

  const vnode = <CommentLayer data={data} content={document.querySelector(CONTENT_SELECTOR)} />;
  if (hydrated) {
    render(vnode, root);
  } else {
    hydrate(vnode, root);
    hydrated = true;
  }
}
