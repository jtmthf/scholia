import { describe, expect, it } from "vitest";
import { matchSiteRoute, pinnedVersion, sitePath } from "../src/routes.js";

// The server matches URLs and the client builds them, so these two have to be each
// other's inverse. Anything that drifts here shows up as a Page that renders cold
// but not on click, or vice versa.
describe("matchSiteRoute", () => {
  it("matches a Site root with no Page path", () => {
    expect(matchSiteRoute("/s/abc123")).toEqual({ slug: "abc123" });
  });

  it("keeps a nested Page path whole", () => {
    expect(matchSiteRoute("/s/abc123/guide/intro.md")).toEqual({
      slug: "abc123",
      pagePath: "guide/intro.md",
    });
  });

  it("decodes each segment, so an encoded slash stays inside its segment", () => {
    expect(matchSiteRoute("/s/abc123/a%20folder/re%2Fname.md")).toEqual({
      slug: "abc123",
      pagePath: "a folder/re/name.md",
    });
  });

  it("rejects anything that isn't a viewer URL", () => {
    expect(matchSiteRoute("/")).toBeNull();
    expect(matchSiteRoute("/agent-docs")).toBeNull();
    expect(matchSiteRoute("/s")).toBeNull();
  });
});

describe("sitePath", () => {
  it("round-trips with matchSiteRoute", () => {
    const url = sitePath("abc123", "guide/intro.md");
    expect(url).toBe("/s/abc123/guide/intro.md");
    expect(matchSiteRoute(url)).toEqual({ slug: "abc123", pagePath: "guide/intro.md" });
  });

  it("addresses a Site root", () => {
    expect(sitePath("abc123")).toBe("/s/abc123");
    expect(sitePath("abc123", null)).toBe("/s/abc123");
  });

  // Carrying the pin is what keeps a historical permalink historical as the reader
  // moves through Nav (CONTEXT "Latest").
  it("carries a pinned Version", () => {
    expect(sitePath("abc123", "guide/intro.md", 2)).toBe("/s/abc123/guide/intro.md?v=2");
    expect(sitePath("abc123", null, 2)).toBe("/s/abc123?v=2");
  });

  it("omits the pin on Latest", () => {
    expect(sitePath("abc123", "x.md", null)).toBe("/s/abc123/x.md");
  });
});

describe("pinnedVersion", () => {
  it("reads a Version ordinal", () => {
    expect(pinnedVersion({ v: "3" })).toBe(3);
  });

  it("treats anything that isn't an ordinal as Latest", () => {
    expect(pinnedVersion({})).toBeNull();
    expect(pinnedVersion({ v: "0" })).toBeNull();
    expect(pinnedVersion({ v: "-1" })).toBeNull();
    expect(pinnedVersion({ v: "1.5" })).toBeNull();
    expect(pinnedVersion({ v: "latest" })).toBeNull();
    expect(pinnedVersion({ v: "" })).toBeNull();
  });
});
