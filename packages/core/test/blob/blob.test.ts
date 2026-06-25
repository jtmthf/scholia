import { describe, expect } from "vitest";
import { test } from "../helpers/tmp.js";
import { FsBlobStore, hashBytes, isValidHash, shardedKey } from "../../src/blob/index.js";

const enc = new TextEncoder();

describe("content addressing", () => {
  test("hashBytes is a deterministic lowercase hex sha256", () => {
    const h = hashBytes(enc.encode("hello"));
    // sha256("hello")
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(isValidHash(h)).toBe(true);
  });

  test("shards a hash into nested directories", () => {
    const h = hashBytes(enc.encode("hello"));
    expect(shardedKey(h)).toBe(`2c/f2/${h}`);
  });
});

describe("FsBlobStore", () => {
  test("round-trips bytes by content hash", async ({ tmp }) => {
    const store = new FsBlobStore(tmp.root);
    const data = enc.encode("the quick brown fox");

    const put = await store.put(data);
    expect(put.existed).toBe(false);
    expect(put.size).toBe(data.byteLength);
    expect(isValidHash(put.hash)).toBe(true);

    expect(await store.has(put.hash)).toBe(true);
    const got = await store.get(put.hash);
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!)).toBe("the quick brown fox");
  });

  test("is idempotent — a repeat put reports the blob already existed", async ({ tmp }) => {
    const store = new FsBlobStore(tmp.root);
    const data = enc.encode("dedupe me");

    const first = await store.put(data);
    const second = await store.put(data);
    expect(first.existed).toBe(false);
    expect(second.existed).toBe(true);
    expect(second.hash).toBe(first.hash);
  });

  test("returns null for an absent or malformed hash", async ({ tmp }) => {
    const store = new FsBlobStore(tmp.root);
    const absent = hashBytes(enc.encode("never stored"));
    expect(await store.get(absent)).toBeNull();
    expect(await store.has(absent)).toBe(false);
    expect(await store.get("not-a-real-hash")).toBeNull();
  });
});
