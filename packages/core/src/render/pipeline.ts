import { createHighlighter, type Highlighter } from "shiki";

export const SHIKI_THEMES = { light: "rose-pine-dawn", dark: "rose-pine-moon" } as const;

export const SHIKI_OPTIONS = {
  themes: SHIKI_THEMES,
  // Emit only CSS variables; we apply colors via .shiki rules so a single
  // `html.dark` class toggle flips every code block with no client JS.
  defaultColor: false as const,
  fallbackLanguage: "plaintext",
};

// Curated language set kept small so cold start stays fast. Unknown languages
// fall back to `plaintext` via SHIKI_OPTIONS.fallbackLanguage.
const LANGS = [
  "javascript", "typescript", "jsx", "tsx", "json", "jsonc",
  "html", "css", "scss", "less", "vue", "svelte",
  "bash", "shell", "powershell", "python", "ruby", "php",
  "go", "rust", "java", "kotlin", "swift", "c", "cpp", "csharp",
  "yaml", "toml", "ini", "xml", "markdown", "mdx",
  "sql", "graphql", "diff", "dockerfile", "make", "nginx", "plaintext",
];

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_THEMES.light, SHIKI_THEMES.dark],
      langs: LANGS,
    });
  }
  return highlighterPromise;
}
