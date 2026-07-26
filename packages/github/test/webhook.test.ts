import { describe, test, expect } from "vitest";
import { parseWebhook, verifySignature, WebhookSignatureError } from "../src/webhook.js";
import type { InboundLifecycle, InboundReviewComment } from "../src/inbound.js";

const SECRET = "whodunit";

function sign(body: string): string {
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

function reviewCommentPayload(action: string, extra: Record<string, unknown> = {}): unknown {
  return {
    action,
    comment: {
      id: 101,
      node_id: "PRRC_101",
      html_url: "https://github.com/o/r/pull/3#discussion_r101",
      path: "doc.md",
      line: 7,
      side: "RIGHT",
      original_line: 7,
      original_side: "RIGHT",
      commit_id: "shasha",
      user: { login: "octocat", avatar_url: "https://avatar" },
      ...extra,
    },
    pull_request: { number: 3 },
    repository: { full_name: "o/r" },
  };
}

describe("webhook: verifySignature", () => {
  const body = JSON.stringify({ hi: 1 });
  test("accepts a valid signature", () => {
    expect(() => verifySignature(body, sign(body), SECRET)).not.toThrow();
  });
  test("rejects a missing header", () => {
    expect(() => verifySignature(body, null, SECRET)).toThrow(WebhookSignatureError);
  });
  test("rejects a malformed header", () => {
    expect(() => verifySignature(body, "notasha256", SECRET)).toThrow(WebhookSignatureError);
  });
  test("rejects a wrong signature", () => {
    expect(() => verifySignature(body, "sha256=" + "0".repeat(64), SECRET)).toThrow(
      WebhookSignatureError,
    );
  });
  test("accepts a Uint8Array body", () => {
    expect(() => verifySignature(new TextEncoder().encode(body), sign(body), SECRET)).not.toThrow();
  });
});

describe("webhook: parseWebhook", () => {
  test("review_comment.created → one InboundReviewComment", () => {
    const ev = parseWebhook("pull_request_review_comment", reviewCommentPayload("created"));
    expect(ev.length).toBe(1);
    const e = ev[0] as InboundReviewComment;
    expect(e.kind).toBe("review_comment");
    expect(e.repo).toBe("o/r");
    expect(e.prNumber).toBe(3);
    expect(e.externalId).toBe("101");
    expect(e.path).toBe("doc.md");
    expect(e.line).toBe(7);
    expect(e.side).toBe("RIGHT");
    expect(e.author.login).toBe("octocat");
    expect(e.commit).toBe("shasha");
    expect(e.action).toBe("created");
  });

  test("unsupported action yields []", () => {
    expect(parseWebhook("pull_request_review_comment", reviewCommentPayload("labeled"))).toEqual(
      [],
    );
  });

  test("issue_comment only on a PR-linked issue", () => {
    const onPr = {
      action: "created",
      comment: { id: 9, html_url: "u", user: { login: "joe" }, body: "hey" },
      issue: { number: 3, pull_request: {} },
      repository: { full_name: "o/r" },
    };
    const ev = parseWebhook("issue_comment", onPr);
    expect(ev.length).toBe(1);
    expect(ev[0]!.kind).toBe("issue_comment");

    const onIssue = { ...onPr, issue: { number: 3 } };
    expect(parseWebhook("issue_comment", onIssue)).toEqual([]);
  });

  test("pull_request synchronize → lifecycle", () => {
    const ev = parseWebhook("pull_request", {
      action: "synchronize",
      pull_request: { number: 3, head: { sha: "new", ref: "feat" }, merged: false },
      repository: { full_name: "o/r" },
    });
    expect(ev.length).toBe(1);
    const e = ev[0] as InboundLifecycle;
    expect(e.kind).toBe("lifecycle");
    expect(e.action).toBe("synchronize");
    expect(e.headSha).toBe("new");
    expect(e.branch).toBe("feat");
    expect(e.merged).toBe(false);
  });

  test("pull_request closed merged=true", () => {
    const ev = parseWebhook("pull_request", {
      action: "closed",
      pull_request: { number: 3, head: { sha: "new" }, merged: true },
      repository: { full_name: "o/r" },
    }) as InboundLifecycle[];
    expect(ev[0]!.action).toBe("closed");
    expect(ev[0]!.merged).toBe(true);
  });

  test("pull_request_review submitted", () => {
    const ev = parseWebhook("pull_request_review", {
      action: "submitted",
      review: {
        id: 5,
        html_url: "u",
        user: { login: "x" },
        state: "APPROVED",
        body: "ship",
        commit_id: "c",
      },
      pull_request: { number: 3 },
      repository: { full_name: "o/r" },
    });
    expect(ev.length).toBe(1);
    expect(ev[0]!.kind).toBe("review");
    if (ev[0]!.kind === "review") expect(ev[0]!.state).toBe("APPROVED");
  });

  test("pull_request_review_thread resolved → InboundThreadResolved", () => {
    const ev = parseWebhook("pull_request_review_thread", {
      action: "resolved",
      thread: { comments: [{ id: 101 }, { id: 102 }] },
      pull_request: { number: 3 },
      repository: { full_name: "o/r" },
      sender: { login: "reviewer1" },
    });
    expect(ev.length).toBe(1);
    const e = ev[0] as import("../src/inbound.js").InboundThreadResolved;
    expect(e.kind).toBe("thread_resolved");
    expect(e.repo).toBe("o/r");
    expect(e.prNumber).toBe(3);
    expect(e.externalId).toBe("101"); // the thread's first/root comment
    expect(e.resolved).toBe(true);
    expect(e.resolvedBy).toBe("reviewer1");
  });

  test("pull_request_review_thread unresolved → resolved: false", () => {
    const ev = parseWebhook("pull_request_review_thread", {
      action: "unresolved",
      thread: { comments: [{ id: 55 }] },
      pull_request: { number: 3 },
      repository: { full_name: "o/r" },
      sender: { login: "reviewer2" },
    }) as import("../src/inbound.js").InboundThreadResolved[];
    expect(ev[0]!.resolved).toBe(false);
    expect(ev[0]!.externalId).toBe("55");
  });

  test("pull_request_review_thread unsupported action yields []", () => {
    expect(
      parseWebhook("pull_request_review_thread", {
        action: "edited",
        thread: { comments: [{ id: 1 }] },
        pull_request: { number: 3 },
        repository: { full_name: "o/r" },
      }),
    ).toEqual([]);
  });

  test("pull_request_review_thread with no comments yields []", () => {
    expect(
      parseWebhook("pull_request_review_thread", {
        action: "resolved",
        thread: { comments: [] },
        pull_request: { number: 3 },
        repository: { full_name: "o/r" },
      }),
    ).toEqual([]);
  });

  test("unknown event → []", () => {
    expect(parseWebhook("ping", { zen: "x" })).toEqual([]);
  });

  test("non-object/null payload → []", () => {
    expect(parseWebhook("pull_request", null)).toEqual([]);
  });
});
