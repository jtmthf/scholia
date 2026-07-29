import { createApp } from "./server.js";
import { DEV_ASSETS } from "./document.js";

// The entry @hono/vite-dev-server mounts inside Vite's dev server: Vite owns the
// port and the module graph, this app owns the HTML. In dev the client entry is
// served from source and Vite injects its own HMR client into the response.
export default createApp(DEV_ASSETS);
