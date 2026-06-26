import { describe, expect } from "vitest";
import { test } from "./helpers/tmp.js";
import { zipSync } from "fflate";
import { collectFiles } from "../src/collect.js";

const enc = new TextEncoder();

describe("collectFiles — directory", () => {
  test("collects files with POSIX-relative paths", async ({ tmp }) => {
    await tmp.write("README.md", "# Hello");
    await tmp.write("img/logo.png", enc.encode("PNG"));
    await tmp.write("guide/intro.md", "# Intro");

    const files = await collectFiles(tmp.root);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["README.md", "guide/intro.md", "img/logo.png"]);
  });

  test("classifies .md/.markdown as markdown, .html as html, everything else as asset", async ({ tmp }) => {
    await tmp.write("doc.md", "content");
    await tmp.write("notes.MARKDOWN", "notes");
    await tmp.write("page.html", "<html>");
    await tmp.write("logo.png", "PNG");

    const files = await collectFiles(tmp.root);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.kind]));
    expect(byPath["doc.md"]).toBe("markdown");
    expect(byPath["notes.MARKDOWN"]).toBe("markdown");
    expect(byPath["page.html"]).toBe("html");
    expect(byPath["logo.png"]).toBe("asset");
  });

  test("skips .git, node_modules, and dotfiles/dotdirs", async ({ tmp }) => {
    await tmp.write("keep.md", "keep");
    await tmp.write(".git/config", "git config");
    await tmp.write("node_modules/pkg/index.js", "module");
    await tmp.write(".hidden", "hidden");
    await tmp.write(".dotdir/file.md", "dotdir file");

    const files = await collectFiles(tmp.root);
    expect(files.map((f) => f.path)).toEqual(["keep.md"]);
  });

  test("produces a stable contentHash from file bytes", async ({ tmp }) => {
    await tmp.write("a.md", "hello");
    await tmp.write("b.md", "hello");

    const files = await collectFiles(tmp.root);
    const sorted = files.sort((a, b) => a.path.localeCompare(b.path));
    expect(sorted[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sorted[0]!.contentHash).toBe(sorted[1]!.contentHash);
  });
});

describe("collectFiles — single file", () => {
  test("single file uses its basename as path", async ({ tmp }) => {
    const full = await tmp.write("doc.md", "# Doc");
    const files = await collectFiles(full);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("doc.md");
    expect(files[0]!.kind).toBe("markdown");
  });

  test("single non-markdown file is classified as asset", async ({ tmp }) => {
    const full = await tmp.write("logo.png", enc.encode("PNG"));
    const files = await collectFiles(full);
    expect(files[0]!.kind).toBe("asset");
  });
});

describe("collectFiles — zip", () => {
  test("extracts entries at archive-relative paths", async ({ tmp }) => {
    const zip = zipSync({
      "README.md": enc.encode("# Readme"),
      "docs/guide.md": enc.encode("# Guide"),
      "img/logo.png": enc.encode("PNG"),
    });
    const zipPath = await tmp.write("site.zip", zip);

    const files = await collectFiles(zipPath);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["README.md", "docs/guide.md", "img/logo.png"]);
  });

  test("skips dotfiles and node_modules inside zip", async ({ tmp }) => {
    const zip = zipSync({
      "keep.md": enc.encode("keep"),
      ".hidden": enc.encode("hidden"),
      "node_modules/pkg.js": enc.encode("module"),
      ".git/config": enc.encode("git"),
    });
    const zipPath = await tmp.write("site.zip", zip);

    const files = await collectFiles(zipPath);
    expect(files.map((f) => f.path)).toEqual(["keep.md"]);
  });

  test("classifies zip entries correctly", async ({ tmp }) => {
    const zip = zipSync({
      "page.md": enc.encode("md"),
      "asset.png": enc.encode("png"),
      "page.html": enc.encode("<html>"),
    });
    const zipPath = await tmp.write("out.zip", zip);

    const files = await collectFiles(zipPath);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.kind]));
    expect(byPath["page.md"]).toBe("markdown");
    expect(byPath["asset.png"]).toBe("asset");
    expect(byPath["page.html"]).toBe("html");
  });

  test("deduplicates identical content by hash", async ({ tmp }) => {
    const content = enc.encode("same content");
    const zip = zipSync({
      "a.md": content,
      "b.md": content,
    });
    const zipPath = await tmp.write("dup.zip", zip);

    const files = await collectFiles(zipPath);
    expect(files).toHaveLength(2);
    expect(files[0]!.contentHash).toBe(files[1]!.contentHash);
  });
});
