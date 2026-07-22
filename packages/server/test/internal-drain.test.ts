import { describe, test, expect } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "@collab/db";
import type { BlobStore } from "@collab/core";

// Unit test for the M11 `/internal/drain` route (ADR-0015): the bearer-auth'd,
// platform-agnostic drain+reconcile trigger. No mirror providers are
// registered in these apps, so `runMirrorDrain` no-ops before touching the db
// — a real Postgres/S3 isn't needed here (contrast: mirror-drain behavior
// itself is covered by the M10 outbound-dispatch integration test).
const fakeDb = {} as unknown as Db;
const fakeStore = {} as unknown as BlobStore;

function baseDeps(internalSecret: string | null) {
  return {
    db: fakeDb,
    store: fakeStore,
    publicUrl: "http://api.test",
    viewerUrl: "http://viewer.test",
    internalSecret,
  };
}

describe("/internal/drain", () => {
  test("404s when COLLAB_INTERNAL_SECRET is unset", async () => {
    const app = createApp(baseDeps(null));
    const res = await app.request("/internal/drain", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("401s with no Authorization header", async () => {
    const app = createApp(baseDeps("s3cr3t"));
    const res = await app.request("/internal/drain", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("401s with the wrong bearer token", async () => {
    const app = createApp(baseDeps("s3cr3t"));
    const res = await app.request("/internal/drain", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  test("200s with the correct bearer token, via POST", async () => {
    const app = createApp(baseDeps("s3cr3t"));
    const res = await app.request("/internal/drain", {
      method: "POST",
      headers: { Authorization: "Bearer s3cr3t" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ drained: false, reconciled: 0 });
  });

  test("200s with the correct bearer token, via GET (Vercel Cron only sends GET)", async () => {
    const app = createApp(baseDeps("s3cr3t"));
    const res = await app.request("/internal/drain", {
      headers: { Authorization: "Bearer s3cr3t" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ drained: false, reconciled: 0 });
  });
});
