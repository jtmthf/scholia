import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The hosted Viewer SPA (ADR-0011). Standalone Vite app; it reads the API over
// CORS (VITE_API_URL, default the local server) and embeds Page content from the
// content origin in a sandboxed iframe. M2 is read-only single-Page; the comment
// layer (and a TanStack Query data cache) arrive in M5.
export default defineConfig({
  plugins: [preact()],
  server: { port: 5173 },
});
