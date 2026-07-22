// Vercel's required filesystem entry point (catch-all route) — thin re-export
// so the real adapter logic lives with the rest of the server source under
// src/, not under the deploy-mechanical api/ directory (ADR-0015). Runs on the
// default Node.js runtime (not Edge): postgres-js needs raw TCP sockets, which
// the Edge Runtime doesn't provide.
export { default } from "../src/adapters/vercel.js";
