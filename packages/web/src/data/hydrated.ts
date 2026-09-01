import { useEffect, useState } from "preact/hooks";

/**
 * Whether this tree is running in a browser that has finished hydrating.
 *
 * False on the server *and* on the first client render, then true — the same
 * shape as the identity hooks, and for the same reason: the SSR'd markup and the
 * markup hydration starts from have to be the same document (ADR-0011).
 *
 * What it gates is what the hosted viewer cannot do until then. A hosted write
 * needs an API Token and a client-minted Viewer, both of which live in the
 * browser, so a control rendered before this is true is a control that does
 * nothing when clicked (issue #111, ADR-0038).
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
