import { describe, expect, test } from "vitest";
import { render } from "preact-render-to-string";
import { ContentChangedNotice } from "../src/client/comments/ContentChangedNotice.js";

// Issue #113: the notice used to sit flush in the bottom-left corner — on top
// of the Nav — with no way to put it away. Taking the update was the only exit
// from it, which is the one thing a reader mid-draft may not want to do.
describe("ContentChangedNotice", () => {
  test("offers a dismiss control alongside the update", () => {
    const html = render(
      <ContentChangedNotice
        onTake={() => {
          throw new Error("not called by rendering");
        }}
        onDismiss={() => {
          throw new Error("not called by rendering");
        }}
      />,
    );

    expect(html).toContain("Load changes");
    expect(html).toContain("content-changed-dismiss");
    // Named, not just an unlabelled glyph — the visible × is decorative.
    expect(html).toContain('aria-label="Dismiss"');
  });

  test("stays a status, not an alert — nothing here is wrong or blocked", () => {
    const html = render(<ContentChangedNotice onTake={() => {}} onDismiss={() => {}} />);
    expect(html).toContain('role="status"');
  });
});
