// Returns the self-contained iframe bridge script that the server inlines into
// every content document. The script is pre-bundled by scripts/build-iframe.mjs.
import { IFRAME_SCRIPT } from "./iframe-script.generated.js";

export function iframeBridgeScript(): string {
  return IFRAME_SCRIPT;
}
