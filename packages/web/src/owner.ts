// Owner token — per-Site, stored in localStorage.
// localStorage-grade, same as Viewer identity (ADR-0006).
// This token confers full owner write capability (ADR-0005); NEVER expose it
// to human reviewers — they receive the Share URL, not the Agent URL.
// Key: collab:owner:<slug> → token string

function storageKey(slug: string): string {
  return `collab:owner:${slug}`;
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
}

export function clearOwnerToken(slug: string): void {
  try {
    localStorage.removeItem(storageKey(slug));
  } catch {}
}
