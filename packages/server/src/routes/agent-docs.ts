// The agent docs this server serves (ADR-0021, issue #35).
//
// Served, not shipped: the document is generated from the application layer's
// verb registry, with the hosted target's prose — tiers, tokens, Versions —
// selected by `target: "hosted"`. Nothing here restates a verb, so a verb that
// changes shape changes here without anyone remembering to look.
//
// Two representations of one document, the same way a Page is served (issue
// #64): HTML for the human who clicked the link, Markdown for the agent that
// asked for it with `?raw` or `Accept: text/markdown`.

import { Hono, type Context } from "hono";
import {
  acceptsMarkdown,
  renderAgentDocs,
  renderAgentDocsHtml,
  type AgentDocsInstance,
} from "@scholia/core";
import type { AppDeps } from "../config.js";
import { contentBaseFor } from "../content-origin.js";

export function agentDocsRoutes(getDeps?: () => AppDeps) {
  const app = new Hono();

  // Rendered once per process rather than per request: the docs are a pure
  // function of the registry, and the HTML half loads a syntax highlighter.
  let html: Promise<string> | undefined;

  // The docs are the server's, not one Site's, so the examples carry a
  // placeholder slug — and the content base is built from it, which is what
  // makes the example show this deployment's actual content-origin shape
  // (path-based or a per-Site subdomain).
  const SLUG = "your-site-slug";

  const instance = (): AgentDocsInstance => {
    // The addresses only fill in copy-pasteable examples, so a server whose
    // environment has not resolved yet still serves docs — with the placeholder
    // host the packaged copy carries.
    let deps: AppDeps | undefined;
    try {
      deps = getDeps?.();
    } catch {
      deps = undefined;
    }
    if (!deps) return { target: "hosted", site: SLUG };

    return {
      target: "hosted",
      site: SLUG,
      server: deps.publicUrl,
      contentBase: contentBaseFor(SLUG, deps),
      docsUrl: `${deps.publicUrl}/agent-docs`,
    };
  };

  const markdown = (c: Context) => {
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(renderAgentDocs(instance()));
  };

  // GET /agent-docs — the verb reference with its prompt-injection trust
  // framing. No auth: an agent reads this before it has anything else.
  app.get("/agent-docs", async (c) => {
    if (c.req.query("raw") !== undefined || acceptsMarkdown(c.req.header("Accept") ?? null)) {
      c.header("Vary", "Accept");
      return markdown(c);
    }
    html ??= renderAgentDocsHtml(instance());
    return c.html(await html);
  });

  // GET /scholia.SKILL.md — the same Markdown under the name agent prompts and
  // older skills point at.
  app.get("/scholia.SKILL.md", (c) => markdown(c));

  return app;
}
