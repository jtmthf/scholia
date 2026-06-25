import { createHash, randomBytes } from "node:crypto";

// Capability tokens and Site slugs are random opaque strings (PLAN §4,
// ADR-0001/0005). Slugs gate read access (the unguessable URL); owner tokens
// gate write/owner actions and are persisted only as a hash.

// The Share URL slug: ~16 random bytes, URL-safe. Long enough to be unguessable.
export function randomSlug(): string {
  return randomBytes(16).toString("base64url");
}

// An owner capability token: 32 random bytes, URL-safe. Returned once to the
// CLI; only its hash is stored.
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

// Tokens are stored hashed; a presented token is hashed and compared (PLAN §4).
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
