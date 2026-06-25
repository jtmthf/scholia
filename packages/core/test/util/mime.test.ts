import { describe, test, expect } from "vitest";
import { contentType } from "../../src/util/mime.js";

describe("contentType", () => {
  test("returns the right MIME type for known extensions", () => {
    expect(contentType("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentType("styles.css")).toBe("text/css; charset=utf-8");
    expect(contentType("diagram.svg")).toBe("image/svg+xml");
    expect(contentType("photo.png")).toBe("image/png");
  });

  test("matches extensions case-insensitively", () => {
    expect(contentType("PHOTO.PNG")).toBe("image/png");
  });

  test("falls back to octet-stream for unknown extensions", () => {
    expect(contentType("archive.xyz")).toBe("application/octet-stream");
    expect(contentType("noextension")).toBe("application/octet-stream");
  });
});
