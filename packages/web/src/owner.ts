// Owner token — per-Site, stored in localStorage.
// localStorage-grade, same as Viewer identity (ADR-0006).
// This token confers full owner write capability (ADR-0005); NEVER expose it
// to human reviewers — they receive the Share URL, not the Agent URL.
// Key: scholia:owner:<slug> → token string

function storageKey(slug: string): string {
  return `scholia:owner:${slug}`;
}

// Same reason as the Viewer store: read during render, written from handlers, and
// localStorage fires no same-document event.
const listeners = new Set<() => void>();

/** Subscribe to owner-token changes. Returns an unsubscribe function. */
export function subscribeOwnerToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function getOwnerToken(slug: string): string | null {
  try {
    return localStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
}

export function setOwnerToken(slug: string, token: string): void {
  try {
    localStorage.setItem(storageKey(slug), token);
  } catch {}
  notify();
}

export function clearOwnerToken(slug: string): void {
  try {
    localStorage.removeItem(storageKey(slug));
  } catch {}
  notify();
}
