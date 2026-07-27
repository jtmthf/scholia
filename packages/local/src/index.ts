// @scholia/local — the Local Preview server (ADR-0010). Serves a local file or
// folder over Hono with file-watch + live-reload and an SSR'd reading view,
// using the shared render/Nav/search engine from @scholia/core. Trusted local
// content: no auth, no network, no DB. (ex-mdttp.)
export { startServer, type StartOptions, type RunningServer } from "./server.js";
// "Open in editor" (ADR-0017): the CLI validates and persists `--editor`; the
// server does the detection and the spawning.
export { checkEditorOverride, type OverrideCheck, type ResolvedEditor } from "./editor.js";
export { configPath, loadConfig, saveEditorPreference, type LocalConfig } from "./config.js";
