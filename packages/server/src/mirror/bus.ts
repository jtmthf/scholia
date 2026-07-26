// In-process outbound mirror bus (ADR-0008, M10; single-attempt dispatch per
// ADR-0015, M11). A domain event emitted by a route (public comment created,
// resolve/reopen, promotion) is persisted as a `comment_mirrors` row with
// `status="pending"` AND a serialized `payload`, then dispatched to the
// matching provider once, inline, in the same request. Failures degrade to
// DB-only (never abort the user's request): the row stays `pending` for the
// next periodic drain sweep (`runMirrorDrain`, driven by `/internal/drain` or
// self-host's boot-time interval) to retry, up to MAX_ATTEMPTS, after which the
// row is marked `failed`. `start()` runs one drain pass on boot so a crash or
// restart replays the queue immediately rather than waiting for the interval.
//
// The bus is injectable on `AppDeps`; tests and local dev use `NoopMirrorBus`.

import type { Db } from "@scholia/db";
import {
  bumpMirrorAttempts,
  getMirrorRow,
  pendingMirrorRows,
  touchMirrorRow,
} from "@scholia/db";
import type {
  MirrorBinding,
  MirrorContext,
  MirrorEvent,
  MirrorProvider,
} from "@scholia/core";
import { isGitHubMirror } from "@scholia/core";

// The serialized form of a MirrorEvent stored on `comment_mirrors.payload` for
// replay-by-row on startup. Includes its identity/anchor since the source rows
// could change between emit and replay (e.g. a promotion hide) — the payload is
// the authoritative snapshot of what to push.

export const MAX_ATTEMPTS = 8;

export interface MirrorBusOptions {
  providers: MirrorProvider[];
  db: Db;
  /** Builds the MirrorContext handed to a provider's dispatch (resolves Page source bytes). */
  contextFor: (binding: MirrorBinding) => MirrorContext;
  /** Max attempts before a row is marked `failed`; default MAX_ATTEMPTS. */
  maxAttempts?: number;
}

export interface MirrorBus {
  emit(event: MirrorEvent): void;
  start(): Promise<void>;
  stop(): void;
  /** Test hook: drain pending rows once, synchronously (no backoff waits). */
  drainNow?(): Promise<void>;
}

// ---- NoopMirrorBus (default for tests / local dev / non-PR-backed Sites) ----

class NoopMirrorBus implements MirrorBus {
  emit() {}
  async start() {}
  stop() {}
}

export const noopMirrorBus: MirrorBus = new NoopMirrorBus();

// ---- MirrorBus impl ----

class InProcessMirrorBus implements MirrorBus {
  private readonly providers = new Map<string, MirrorProvider>();
  private readonly db: Db;
  private readonly contextFor: (binding: MirrorBinding) => MirrorContext;
  private readonly maxAttempts: number;
  private running = false;
  private inFlight = new Set<Promise<void>>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  // Hook the server wires so the reconciliation poll can ride the same lifecycle.
  onTickReconcile?: () => Promise<void>;

  constructor(opts: MirrorBusOptions) {
    for (const p of opts.providers) this.providers.set(p.id, p);
    this.db = opts.db;
    this.contextFor = opts.contextFor;
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  }

  emit(event: MirrorEvent): void {
    // Never throw into the request — enqueue + persist best-effort.
    try {
      const p = this.handle(event).catch(() => {
        // Swallow; state is in the DB row.
      });
      this.inFlight.add(p);
      p.finally(() => this.inFlight.delete(p));
    } catch {
      // ignore
    }
  }

  // Resolve produces no new comment (it flips an existing thread's state), so it
  // has no `comment_mirrors` row of its own — it dispatches best-effort against the
  // thread of an already-synced comment in the conversation. Resolve is last-writer-
  // wins; a transient dispatch failure is later reconciled by the inbound poll.
  // Comment_created and promotion DO persist a pending row keyed per-comment.
  private async handle(event: MirrorEvent): Promise<void> {
    const provider = this.providers.get(event.mirrorBinding.provider);
    if (!provider) return;

    if (event.type === "resolve") {
      try {
        const ctx = this.contextFor(event.mirrorBinding);
        await provider.dispatch([event], ctx);
      } catch {
        // best-effort; the reconcile poll imports resolve state from GitHub.
      }
      return;
    }

    const commentIds =
      event.type === "promotion" ? event.comments.map((c) => c.commentId) : [event.commentId];
    for (const commentId of commentIds) {
      try {
        await touchMirrorRow(this.db, {
          commentId,
          provider: provider.id,
          externalId: "",
          status: "pending",
          payload: serializeEvent(event, commentId),
        });
      } catch {
        // ignore — emit must never throw
      }
    }
    for (const commentId of commentIds) {
      const payload = serializeEvent(event, commentId);
      try {
        await this.dispatchOne(provider, payload, commentId);
      } catch {
        // swallowed — dispatchOne updates the row on its own retry path
      }
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Startup replay: dispatch every pending/under-cap-failed row once.
    await this.drainNow?.();
  }

  stop(): void {
    this.running = false;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  async drainNow(): Promise<void> {
    for (const provider of this.providers.values()) {
      let rows: Awaited<ReturnType<typeof pendingMirrorRows>> = [];
      try {
        rows = await pendingMirrorRows(this.db, provider.id);
      } catch {
        continue;
      }
      for (const row of rows) {
        if (!row.payload) continue; // nothing to replay without a serialized event
        try {
          await this.dispatchOne(provider, row.payload as MirrorEvent, row.commentId);
        } catch {
          // best-effort; state already advanced by dispatchOne's retry logic
        }
      }
    }
  }

  // A single inline dispatch attempt (ADR-0015): no in-process retry/backoff —
  // `emit()` calls this once per event, and the periodic drain sweep
  // (`drainNow`, driven by `runMirrorDrain`) is the sole retry path for a row
  // still `pending`/`failed`-under-cap. This is what makes the bus safe under a
  // serverless function that terminates at the response.
  private async dispatchOne(provider: MirrorProvider, event: MirrorEvent, commentId: string): Promise<void> {
    const ctx = this.contextFor(event.mirrorBinding);
    try {
      await provider.dispatch([event], ctx);
      // Success: read the external id/url from the provider via the mirror row.
      // The provider's dispatch is expected to upsert the mirror row itself on
      // success (it owns the GitHub comment id). We mark synced here only if the
      // provider didn't already — check the row.
      const row = await getMirrorRow(this.db, commentId, provider.id);
      if (row && row.status === "pending") {
        // Provider didn't record a synced row (best-effort resolve failure etc.):
        // mark synced without an external id only when dispatch returned cleanly.
        await touchMirrorRow(this.db, {
          commentId,
          provider: provider.id,
          externalId: row.externalId || "",
          externalUrl: row.externalUrl,
          status: "synced",
        });
      }
    } catch {
      const attempts = await bumpMirrorAttempts(this.db, { commentId, provider: provider.id });
      if (attempts >= this.maxAttempts) {
        await touchMirrorRow(this.db, {
          commentId,
          provider: provider.id,
          externalId: "",
          status: "failed",
        });
      }
      // Under the cap: the row is already `pending` (touchMirrorRow above at
      // enqueue time) — the next drain sweep will retry it.
    }
  }
}

// Serialize a MirrorEvent keyed to a specific commentId (promotion carries many;
// each comment_mirrors row carries the single-comment slice it represents so the
// startup replay can re-dispatch per-comment without re-splitting).
function serializeEvent(event: MirrorEvent, commentId: string): MirrorEvent {
  if (event.type === "promotion") {
    const c = event.comments.find((x) => x.commentId === commentId);
    if (!c) return event;
    return {
      ...event,
      type: "comment_created",
      commentId: c.commentId,
      author: c.author,
      body: c.body,
      anchor: c.anchor,
      origin: "scholia",
    } as MirrorEvent;
  }
  return event;
}

// Build a default bus from options + a context builder; `noopMirrorBus` otherwise.
export function createMirrorBus(opts: MirrorBusOptions): MirrorBus {
  if (opts.providers.length === 0) return noopMirrorBus;
  return new InProcessMirrorBus(opts);
}

// Convenience: the event's binding gates outbound — only GitHub mirrors in v1.
export function shouldMirror(binding: MirrorBinding | null): boolean {
  return isGitHubMirror(binding);
}