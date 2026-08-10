# ADR-0035: The database owns time

- Status: Accepted
- Date: 2026-08-09
- Closes: issue #41

## Context

Three separate defects fixed in issue #18 all had the same root cause: a timestamp produced under one clock or precision was later compared under another. Issue #41 asked for the convention to be written down so the same mistake would not be re-invented (and gotten wrong) at each call site.

1. `PostgresRateLimiter.retryAfterMs` was computed in the app as `resetAt - Date.now()`. `resetAt` was stamped by Postgres, while `Date.now()` is the Node process clock. Any skew between the two machines leaked directly into the retry hint.
2. `listSiteComments`' `?since` filter compared microsecond-precision `comments.created_at` (Postgres) against the millisecond-precision ISO string the API emitted. A client paging by feeding the last emitted `createdAt` back in as `since` received the boundary comment forever.
3. The test for `?since` captured its cutoff from `new Date()` (Node clock) and compared it against Postgres-stamped rows — the same cross-clock mistake in test form.

Each site re-invented the rule and got it subtly wrong because there was no written convention.

## Decision

Adopt a single time discipline for every timestamp that lives in Postgres:

1. **The database clock produces and compares DB-resident timestamps.**
   Application code must not subtract a DB timestamp from `Date.now()` or pass `new Date()` into a column that the database could stamp itself. Where a derived duration is needed, compute it in SQL against `now()` in the same statement that read the timestamp. `hitRateLimit`'s `RETURNING retryAfterMs` is the reference shape: `greatest(0, extract(epoch from (reset_at - now())) * 1000)`.

2. **The precision the API emits is the contract.**
   Any value a client can hand back — a `since` cursor, an ETag-ish timestamp, a retry header — must round-trip exactly. Server-side comparisons run at the precision the API emits, not at the higher precision the database may store. `listSiteComments` therefore compares `created_at` against "the next whole millisecond after the emitted `since`", not against the raw ISO string, so the boundary comment is excluded on the next poll.

3. **Tests take cutoffs from values the system emitted, never from the local clock.**
   A test that needs a `since` cursor must read it from an API response (or from a returned DTO), because only that value is measured on the same clock and at the same precision as the rows being filtered. `new Date()` in a test is almost always a cross-clock comparison waiting to happen.

This convention applies only to timestamps persisted in the database. Local Preview and the Sidecar have no database clock; there, the Node process is the sole clock and `new Date().toISOString()` is the correct source.

## Consequences

- **No more cross-clock arithmetic in the app.** Durations derived from DB timestamps are computed in SQL, where the same `now()` sees the same row state.
- **Cursor paging is stable.** A client that polls `list_comments --since=<last-createdAt>` will never see the boundary item twice, because the filter is aligned to the millisecond precision the API promises.
- **Tests become less flaky.** Cutoffs taken from emitted values remove clock skew as a source of non-determinism.
- **New DB columns that need a "now" default should use `defaultNow()` or `sql\`now()\``**, not a value captured in Node. Callers must not pass `new Date()` for a column the database can stamp.

## Alternatives considered

- **Trust NTP and allow cross-clock subtraction.** Rejected: NTP keeps clocks close, but "close" is not a correctness boundary. A retry hint that goes negative or exceeds the window because of skew is a real bug, and relying on infrastructure removes the guarantee from the code.
- **Store and emit timestamps at microsecond precision.** Rejected: JavaScript `Date` has only millisecond precision, so the API cannot faithfully emit microseconds anyway. Aligning the comparison to the emitted precision is simpler and matches what clients can actually represent.
- **Use `Date.now()` everywhere, including DB writes, by passing it as a value.** Rejected: it would make the Node clock authoritative for DB-resident timestamps, reintroducing the same skew problem whenever another process or replica writes to the same row.
