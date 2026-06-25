// @collab/local — the Local Preview server (ADR-0010). Serves a local file or
// folder over Hono with file-watch + live-reload and an SSR'd reading view,
// using the shared render/Nav/search engine from @collab/core. Trusted local
// content: no auth, no network, no DB. (ex-mdttp.)
export { startServer, type StartOptions, type RunningServer } from "./server.js";
