---
"@scholia/core": minor
"@scholia/db": minor
"@scholia/server": patch
---

Move `Identity` domain type into `@scholia/core` and add `./conversation` subpath export. `@scholia/db` renames its stored JSON shape to `IdentityRow` so the domain type and the column serialization are distinct. Server packages now import `Identity` from `@scholia/core` instead of `@scholia/db`.
