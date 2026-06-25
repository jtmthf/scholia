# Content-addressed object storage for content, Postgres for metadata

## Status

accepted

## Context & Decision

Sites are immutable, versioned collections of files, with mutable collaboration data (Threads, Comments, Reactions) layered on top. We store the two separately:

- **Content** goes to an S3-compatible object store (R2/S3/MinIO, or local FS in dev), **content-addressed** by hash of bytes. A **Version** is a manifest mapping each Page/asset path to a content hash. Re-uploading a folder where one file changed stores exactly one new blob; unchanged files dedupe automatically.
- **Metadata** goes to **Postgres**: Sites, Versions (manifests), Pages, Threads, Comments, Reactions, and Anchors. Comments reference `{version, page-path, anchor}`.

We rejected storing content in the DB (D2) because large HTML/assets bloat it and slow serving, and git-as-database (D3) because, despite matching the GitHub mental model, it's operationally awkward and still needs a separate store for comments.

## Consequences

- Cheap Versions and natural dedup via content addressing.
- Two stores to operate, but both are trivially self-hostable (MinIO + Postgres), keeping the open-source "dirt simple to run" promise plausible.
- Lock-in: Postgres-specific features and an S3-compatible API are assumed; swapping either is a meaningful migration.
