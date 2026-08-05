# ADR-0033: Safe-regex input-length guards against polynomial ReDoS

**Date:** 2026-08-05  
**Status:** accepted

## Context

GitHub CodeQL security scanning flagged several "Polynomial regular expression
used on uncontrolled data" alerts (js/polynomial-redos, CWE-1333). The
vulnerability class arises when a regex with super-linear backtracking
characteristics is applied to attacker-controlled input. The recommended
mitigation when the regex itself cannot be simplified is to limit input length
so worst-case backtracking completes in reasonable time.

While the codebase uses conservative regex patterns (negated character classes,
non-greedy quantifiers, bounded repetitions), user-controlled data reaches
regex operations at several boundaries:

- Markdown heading extraction (`extractHeadings`) — entire Page source
- Mention parsing (`parseMentions`) — comment body text
- Inter-Page link rewriting (`rewriteInterPageLinks`) — rendered HTML
- HTML document preparation (`prepareHtmlDocument`) — served HTML
- URL route matching (`matchSiteRoute`) — request pathname
- Authorization header parsing (`bearer()`) — HTTP header

An input-length guard at each of these boundaries closes the ReDoS vector
regardless of regex complexity and serves as a defense-in-depth measure.

## Decision

Introduce `@scholia/core` utility functions that validate input length before
passing data to regex operations:

- `guardRegexInput(input, maxLength?)` — throws when input exceeds limit
- `safeTest(regex, input, maxLength?)` — guarded `RegExp.prototype.test`
- `safeExec(regex, input, maxLength?)` — guarded `RegExp.prototype.exec`
- `safeMatch(input, regex, maxLength?)` — guarded `String.prototype.match`
- `safeReplace(input, regex, replacement, maxLength?)` — guarded replace
- `safeSplit(input, separator, limit?, maxLength?)` — guarded split

The default limit is **50 KB** (`MAX_REGEX_INPUT`). Callers processing
known-larger content (markdown pages, rendered HTML) pass an explicit,
context-appropriate ceiling (500 KB for Page source, 1 MB for HTML).

Each function that accepts uncontrolled string data and applies a regex to it
SHALL call `guardRegexInput` (or the appropriate wrapper) at its entry point
before any regex operation.

## Consequences

- **Positive:** Every regex on user-controlled data is now behind an
  input-length check, closing the polynomial ReDoS vector regardless of
  future regex changes.
- **Positive:** The utility is discoverable — a developer adding a new regex
  on user input can reach for `safeTest`/`safeMatch`/`safeReplace` instead of
  the raw prototype methods.
- **Neutral:** The guards throw on overlong input. At the HTTP boundary this
  becomes a 4xx or 5xx response (the existing error handling in routes
  converts it). At the CLI boundary it halts the command.
- **Negative:** There is no automated enforcement that NEW regex operations
  use the safe wrappers. Reviewers and the CodeQL scanner remain the
  backstop; the utility makes the right thing the easy thing but does not
  make the wrong thing impossible.
