import type { Context } from "hono";
import { getSiteBySlug, verifyOwnerToken, type Identity, type SiteRow } from "@collab/db";
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

// The owner token as presented by an agent: `Authorization: Bearer <token>` (the
// installed CLI/MCP path) or `?token=<token>` (the Owner-scoped Agent URL, ADR-0005).
// The header wins when both are present.
function ownerToken(c: Context): string | null {
  return bearer(c) ?? c.req.query("token") ?? null;
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

// ---- M7: Agent tier ----

// The name Collab uses when an owner-scoped agent supplies no label. Identity is
// effectively `token + label` (CONTEXT "Identity").
const DEFAULT_AGENT_LABEL = "Owner's agent";

export interface AgentAuthOk {
  ok: true;
  site: SiteRow;
  /** The Owner-tier agent Identity to attribute writes to (CONTEXT "Identity"). */
  identity: Identity;
}

// Resolve + authorize an agent request (Owner tier) for a Site slug, building the
// Identity Collab attributes its writes to. Agents present the owner token (header
// or `?token=`); a per-call `label` distinguishes several agents behind one token
// and renders with the agent badge (kind:"agent"). On success returns the Site and
// the composed Identity; otherwise a typed error the route turns into JSON.
export async function authorizeAgent(
  c: Context,
  deps: AppDeps,
  slug: string,
  label?: string | null,
): Promise<AgentAuthOk | OwnerAuthErr> {
  const site = await getSiteBySlug(deps.db, slug);
  if (!site) return { ok: false, status: 404, error: "not found" };

  const token = ownerToken(c);
  if (!token) return { ok: false, status: 401, error: "missing owner token" };

  const valid = await verifyOwnerToken(deps.db, site.id, hashToken(token));
  if (!valid) return { ok: false, status: 403, error: "invalid owner token" };

  const name = (label ?? "").trim() || DEFAULT_AGENT_LABEL;
  const identity: Identity = {
    name,
    kind: "agent",
    tier: "owner",
    onBehalfOf: "Owner",
    source: "native",
  };
  return { ok: true, site, identity };
}

// Whether a request carries an owner token at all (header or `?token=`). Lets a
// dual-mode route (viewer vs agent) branch before doing the DB verify.
export function hasOwnerToken(c: Context): boolean {
  return ownerToken(c) !== null;
}
