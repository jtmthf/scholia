import type { Context } from "hono";
import { getSiteBySlug, verifyOwnerToken, type SiteRow } from "@collab/db";
import type { AppDeps } from "./config.js";
import { hashToken } from "./tokens.js";

// Owner capability-token auth (PLAN §4, ADR-0005). The owner token is presented
// as a bearer credential; we hash it and check for a live owner-kind token row on
// the Site. This is the M6 write gate (re-upload). The full three-tier middleware
// (viewer/agent/anonymous) lands in M8; for now only the owner tier needs a gate.
export interface OwnerAuthOk {
  ok: true;
  site: SiteRow;
}
export interface OwnerAuthErr {
  ok: false;
  status: 401 | 403 | 404;
  error: string;
}

function bearer(c: Context): string | null {
  const h = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

// Resolve + authorize an owner request for a Site slug. Returns the Site on
// success, or a typed error the route turns into a JSON response.
export async function authorizeOwner(
  c: Context,
  deps: AppDeps,
  slug: string,
): Promise<OwnerAuthOk | OwnerAuthErr> {
  const site = await getSiteBySlug(deps.db, slug);
  if (!site) return { ok: false, status: 404, error: "not found" };

  const token = bearer(c);
  if (!token) return { ok: false, status: 401, error: "missing owner token" };

  const valid = await verifyOwnerToken(deps.db, site.id, hashToken(token));
  if (!valid) return { ok: false, status: 403, error: "invalid owner token" };

  return { ok: true, site };
}
