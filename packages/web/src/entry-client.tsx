import { hydrate } from "preact-iso";
import { hydrate as hydrateCache, type DehydratedState } from "@tanstack/react-query";
import { App } from "./app.js";
import { createQueryClient } from "./data/queries.js";
import { deserializeErrors } from "./data/error-serialization.js";

// Every stylesheet the viewer needs is imported here and nowhere else. The shell
// components are rendered on the server too, where a CSS import has no meaning —
// and @scholia/ui deliberately doesn't import its own stylesheet, so that a consumer
// without a bundler can still use it.
import "./styles.css";
import "@scholia/ui/comments.css";
import "./versioning/versioning.css";
import "./agent/agent.css";
import "./owner/owner-panel.css";

declare global {
  interface Window {
    __SCHOLIA_STATE__?: DehydratedState;
  }
}

const client = createQueryClient();
// Replay what the server already fetched, so the Site and its public Threads are
// rendered from cache instead of being refetched behind a loading state.
// Errored queries — dehydrated on the server with `shouldDehydrateQuery` and
// serialized through `serializeErrors` — are reconstructed here so the client
// skips the loading flash and renders the failure view immediately.
if (window.__SCHOLIA_STATE__) {
  deserializeErrors(window.__SCHOLIA_STATE__);
  hydrateCache(client, window.__SCHOLIA_STATE__);
}

const root = document.getElementById("app");
if (root) hydrate(<App client={client} />, root);
