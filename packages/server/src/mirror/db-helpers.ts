// Thin re-export of the @collab/db helpers the GitHub provider needs, with the
// schema namespace + Drizzle `eq` for the resolve-thread lookup. Keeps the
// provider file free of inline dynamic imports and dodgy `await import` chains.

import { eq } from "drizzle-orm";
import { getMirrorRow, schema, touchMirrorRow } from "@collab/db";

export { eq, getMirrorRow, schema, touchMirrorRow };