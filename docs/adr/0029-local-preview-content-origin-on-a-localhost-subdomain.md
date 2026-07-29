# Local Preview's content origin is a `*.localhost` subdomain, probed at runtime

## Status

accepted

Extends [ADR-0003](0003-sandboxed-cross-origin-iframe-for-page-content.md) (sandboxed cross-origin
iframe) and [ADR-0010](0010-local-preview-is-the-default-entry.md) (Local Preview is the default
entry). Evidence: [`docs/research/0023-localhost-subdomain-cross-origin.md`](../research/0023-localhost-subdomain-cross-origin.md).

## Context & Decision

ADR-0003 puts all Page content in a sandboxed iframe on a **separate content origin**. Hosted, that
is a different domain and costs nothing. Locally it looked impossible without a proxy, TLS or
configuration — all of which are barred by the `npx scholia ./docs` promise. The question was
whether Local Preview had to be architecturally special.

It does not. Origin is (scheme, host, port), so `http://content.localhost:3000` and
`http://localhost:3000` are **distinct origins on a single port**, both served by one Hono listener
routed on the `Host` header. No proxy, no TLS, no configuration. This was measured, not assumed:
Chrome 150 and Firefox 152 block DOM access in both directions, report
`event.origin: "http://content.localhost:4123"`, drop messages sent to a wrong `targetOrigin`,
partition localStorage/sessionStorage/IndexedDB, and — the result that mattered most — **reject
every `Domain=localhost` and `Domain=.localhost` cookie**, because the Public Suffix List's default
`*` rule makes `localhost` a public suffix. Chrome says so in its own words when the content Origin
tries to relax `document.domain`: _"'localhost' is a top-level domain."_ Both hosts are also
`isSecureContext: true` over plain HTTP, so the content origin gets `crypto.subtle` and service
workers for free.

**We keep the content origin cross-origin in Local Preview, exactly as hosted**, and reach it at a
`content.` subdomain of whatever host the server was reached on — derived from the request's
`Host`, never hardcoded.

Two things make this less obvious than it looks, and are the reason this ADR exists rather than
just a line of code:

**The distinct host is load-bearing for Standalone, not for the iframe.** An
`<iframe sandbox="allow-scripts">` without `allow-same-origin` already gets an opaque origin in
every browser with no DNS involved, so the framed case would survive a same-origin fallback. But
**Standalone** (CONTEXT.md) is a _top-level_ document — a Page served from the content origin as the
bytes themselves. A parent cannot sandbox a top-level navigation. Standalone is only safe if the
content origin is genuinely a different host. That, not the iframe, is what `*.localhost` buys.

**`*.localhost` is de-facto behaviour, not a standard guarantee.** RFC 6761's resolver clauses are
all SHOULD; the draft that says MUST (`draft-ietf-dnsop-let-localhost-be-localhost`) expired in 2017
and never became an RFC, yet W3C Secure Contexts cites it normatively. Chrome/Edge (since 2017) and
Firefox (since 84) each ship a resolver short-circuit that never touches the OS. **WebKit ships
none** — Safari falls through to the macOS system resolver, which only learned `*.localhost` in
**macOS 26**. On macOS ≤ 15 the failure is total and product-shaped: _"Safari can't find the
server"_, a blank Page in the default browser of someone who just typed `npx scholia ./docs`. Note
this is an **OS-version boundary, not a Safari-version one** — updating Safari does not help.

So the decision is deliberately not a hard dependency. **The viewer probes the content origin at
load with a same-port request, and on failure or timeout falls back to serving Page content from a
path on the app origin** — still sandboxed without `allow-same-origin`, with Standalone links
disabled and a quiet, honest notice that content isolation is reduced in this browser. Losing
`*.localhost` degrades the product; it does not break it. The fallback is Safari-shaped and
time-limited, retiring as macOS 26 adoption completes.

We rejected **same-origin locally with the difference documented**, because it would give Scholia
two isolation models, two bridge behaviours, and a class of bug that only appears hosted — precisely
where it is least recoverable — and would lose Standalone entirely. We rejected **writing
`/etc/hosts`** (needs `sudo`) and **depending on a proxy such as portless** (global install, sudo
auto-elevation, a CA in the system keychain, port 443, `/etc/hosts` writes) — each individually
fatal to zero-config.

## Consequences

- **Stay compatible with portless, never depend on it.** Honour `PORT`/`HOST`; derive absolute URLs
  from `X-Forwarded-Host` falling back to `Host`; never assume `http:`; prefix the `content.` label
  onto the _observed_ host; trust no `X-Forwarded-*` header for authorization. All things a
  well-behaved server does anyway. Under portless's strict mode, `content.myapp.localhost` needs
  `--wildcard` or a second registered route.
- **The probe and its fallback are a real, testable code path**, not a comment. It is the only thing
  standing between a Safari user on macOS 15 and a blank page, so it needs a test that exercises the
  failure branch.
- **Standalone must be disabled, not merely broken, in the fallback.** A Standalone link on the app
  origin would serve untrusted Page bytes top-level with no isolation at all — worse than the thing
  this ADR is protecting.
- **`localhost` is one shared cookie jar across every dev server on the machine** — cookies ignore
  port. Local Preview must keep nothing sensitive in cookies on the viewer origin. Not because the
  content origin can reach them (it cannot; the PSL closes that), but because every other localhost
  project can.
- **Unverified, and knowingly so:** Safari on macOS ≤ 15 (the failure is sourced from WebKit bug
  160504 and an mDNSResponder diff, not observed); Windows' DNS Client behaviour for `*.localhost`
  — moot for Chrome/Edge/Firefox, which bypass the OS resolver, and Safari does not ship there;
  iOS 26; and whether `http://*.localhost` is a secure context in Safari (WebKit bug 171934, still
  NEW). The probe means none of these gaps can break the product — they only decide who gets the
  fallback.
