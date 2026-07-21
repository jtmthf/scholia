// Webhook signature verification + payload parsing (ADR-0008 inbound).
//
// `parseWebhook` is permissive about event *types* we don't mirror (returns `[]`
// for unsupported events) but STRICT about signatures: the inbound HTTP handler
// must call `verifySignature` on the raw body and reject signed-mismatched /
// unsigned payloads even when the poll fallback is enabled.

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type InboundEvent,
  type InboundIssueComment,
  type InboundLifecycle,
  type InboundReview,
  type InboundReviewComment,
  type InboundThreadResolved,
  type ReviewState,
} from "./inbound.js";

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Constant-time HMAC-SHA256 comparison against the `X-Hub-Signature-256` header
 * (the `sha256=<hex>` form). Throws `WebhookSignatureError` on missing/invalid.
 * `rawBody` may be a string or a Uint8Array (the raw request body).
 */
export function verifySignature(
  rawBody: string | Uint8Array,
  sigHeader: string | null | undefined,
  secret: string,
): void {
  if (!sigHeader) throw new WebhookSignatureError("missing X-Hub-Signature-256 header");
  const m = /^sha256=([0-9a-fA-F]+)$/i.exec(sigHeader.trim());
  if (!m) throw new WebhookSignatureError("malformed X-Hub-Signature-256 header");
  const expectedHex = m[1]!.toLowerCase();

  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Compare as equal-length buffers (timingSafeEqual requires equal length).
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(expectedHex, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new WebhookSignatureError("invalid webhook signature");
  }
}

/**
 * Parse a parsed (JSON) GitHub webhook payload into normalized `InboundEvent`s.
 * Returns `[]` for unsupported events. `eventName` is the `X-GitHub-Event` header.
 * Does NOT verify the signature — the caller verifies the raw body first.
 *
 * Supported events: `pull_request_review_comment`, `issue_comment`,
 * `pull_request_review`, `pull_request_review_thread`, `pull_request`. Actions
 * not relevant to mirroring yield `[]` (e.g. `issue_comment.edited`,
 * `pull_request_review_commit`).
 */
export function parseWebhook(eventName: string, payload: unknown): InboundEvent[] {
  if (payload === null || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;

  if (eventName === "pull_request_review_comment") {
    const action = p.action as string | undefined;
    if (action !== "created" && action !== "edited" && action !== "deleted") return [];
    const c = p.comment as Record<string, unknown> | undefined;
    const pr = p.pull_request as Record<string, unknown> | undefined;
    const repo = p.repository as Record<string, unknown> | undefined;
    if (!c || !pr || !repo) return [];
    return [
      {
        kind: "review_comment",
        repo: repo.full_name as string,
        prNumber: pr.number as number,
        externalId: String(c.id),
        externalUrl: (c.html_url as string) ?? "",
        path: (c.path as string) ?? null,
        line: (c.line as number) ?? (c.original_line as number) ?? null,
        side:
          (c.side as "LEFT" | "RIGHT" | null) ??
          (c.original_side as "LEFT" | "RIGHT" | null) ??
          null,
        author: {
          login: ((c.user as Record<string, unknown>)?.login as string) ?? "unknown",
          avatarUrl: ((c.user as Record<string, unknown>)?.avatar_url as string) ?? null,
        },
        body: (c.body as string) ?? "",
        commit: (c.commit_id as string) ?? "",
        action,
      } satisfies InboundReviewComment,
    ];
  }

  if (eventName === "issue_comment") {
    const action = p.action as string | undefined;
    if (action !== "created" && action !== "edited" && action !== "deleted") return [];
    const c = p.comment as Record<string, unknown> | undefined;
    const issue = p.issue as Record<string, unknown> | undefined;
    const repo = p.repository as Record<string, unknown> | undefined;
    if (!c || !issue || !repo) return [];
    // Only treat comments on PR-linked issues (issue.pull_request present).
    if (!issue.pull_request) return [];
    return [
      {
        kind: "issue_comment",
        repo: repo.full_name as string,
        prNumber: issue.number as number,
        externalId: String(c.id),
        externalUrl: (c.html_url as string) ?? "",
        author: {
          login: ((c.user as Record<string, unknown>)?.login as string) ?? "unknown",
          avatarUrl: ((c.user as Record<string, unknown>)?.avatar_url as string) ?? null,
        },
        body: (c.body as string) ?? "",
        action,
      } satisfies InboundIssueComment,
    ];
  }

  if (eventName === "pull_request_review") {
    const action = p.action as string | undefined;
    if (action !== "submitted" && action !== "dismissed") return [];
    const r = p.review as Record<string, unknown> | undefined;
    const pr = p.pull_request as Record<string, unknown> | undefined;
    const repo = p.repository as Record<string, unknown> | undefined;
    if (!r || !pr || !repo) return [];
    return [
      {
        kind: "review",
        repo: repo.full_name as string,
        prNumber: pr.number as number,
        externalId: String(r.id),
        externalUrl: (r.html_url as string) ?? "",
        author: {
          login: ((r.user as Record<string, unknown>)?.login as string) ?? "unknown",
          avatarUrl: ((r.user as Record<string, unknown>)?.avatar_url as string) ?? null,
        },
        state: (r.state as ReviewState) ?? "COMMENTED",
        body: (r.body as string) ?? "",
        commit: (r.commit_id as string) ?? "",
        action,
      } satisfies InboundReview,
    ];
  }

  if (eventName === "pull_request_review_thread") {
    const action = p.action as string | undefined;
    if (action !== "resolved" && action !== "unresolved") return [];
    const thread = p.thread as Record<string, unknown> | undefined;
    const pr = p.pull_request as Record<string, unknown> | undefined;
    const repo = p.repository as Record<string, unknown> | undefined;
    if (!thread || !pr || !repo) return [];
    const comments = thread.comments as Array<Record<string, unknown>> | undefined;
    const first = comments?.[0];
    if (!first) return [];
    return [
      {
        kind: "thread_resolved",
        repo: repo.full_name as string,
        prNumber: pr.number as number,
        externalId: String(first.id),
        resolved: action === "resolved",
        resolvedBy: ((p.sender as Record<string, unknown>)?.login as string) ?? "unknown",
      } satisfies InboundThreadResolved,
    ];
  }

  if (eventName === "pull_request") {
    const action = p.action as string | undefined;
    const pr = p.pull_request as Record<string, unknown> | undefined;
    const repo = p.repository as Record<string, unknown> | undefined;
    if (!pr || !repo) return [];
    const mappedAction = mapLifecycleAction(action);
    if (mappedAction === null) return [];
    return [
      {
        kind: "lifecycle",
        repo: repo.full_name as string,
        prNumber: pr.number as number,
        action: mappedAction,
        headSha: (pr.head as Record<string, unknown>)?.sha as string | undefined,
        branch: (pr.head as Record<string, unknown>)?.ref as string | undefined,
        merged: (pr.merged as boolean) ?? false,
      } satisfies InboundLifecycle,
    ];
  }

  return [];
}

function mapLifecycleAction(action: string | undefined): InboundLifecycle["action"] | null {
  switch (action) {
    case "synchronize":
      return "synchronize";
    case "closed":
      return "closed";
    case "reopened":
      return "reopened";
    case "locked":
      return "locked";
    case "unlocked":
      return "unlocked";
    default:
      return null;
  }
}