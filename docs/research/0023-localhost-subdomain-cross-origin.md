# Does `*.localhost` give a real cross-origin boundary in Local Preview?

Research spike for issue #23. Decides whether ADR-0003's "all Page content runs in a
sandboxed, cross-origin iframe" survives intact in **Local Preview**, or whether Local
Preview has to be architecturally special.

Every claim below is followed to the source that owns it. Where no primary source could
be found, it says so.

## Answer

**Yes, with one browser-shaped caveat and one cookie-shaped caveat.** `http://content.localhost:3000`
and `http://localhost:3000` are unambiguously **distinct origins** — the HTML Standard's
tuple origin is (scheme, host, port) and the hosts differ, so DOM access, `postMessage`
targeting, and every storage endpoint are separated by spec, not by convention
([HTML §7.5](https://html.spec.whatwg.org/multipage/browsers.html#concept-origin),
[Storage §4.2](https://storage.spec.whatwg.org/#storage-keys)). Both origins can be served
by **one Hono listener on one port**, routed by `Host`, with no proxy, no TLS, and no
configuration. Resolution is guaranteed with zero setup in Chrome (since 2017), Edge (same
Chromium code), and Firefox (since **Firefox 84**, December 2020), because each ships a
resolver short-circuit that never consults the OS at all. **Safari is the exception**: WebKit
does no such short-circuit and falls through to the macOS system resolver, which only learned
`*.localhost` in **macOS 26 Tahoe** — before that, `http://foo.localhost:8000` fails outright
with "Safari can't find the server" unless the user has hand-edited `/etc/hosts` or their
upstream DNS happens to answer. That is a hard failure, not a degradation, and it lands
squarely on the `npx scholia ./docs` promise. Separately, cookies are *not* origin-scoped —
but both Chromium and Gecko reject a `Domain=localhost` cookie set from `content.localhost`
because the Public Suffix List algorithm makes `localhost` a public suffix by default, so the
boundary holds there too, provided Scholia never puts anything load-bearing in a cookie.

## What RFC 6761 actually requires

RFC 6761 §6.3 opens: *"The domain `localhost.` and any names falling within `.localhost.` are
special in the following ways"* — so subdomains are in scope by the letter of the RFC
([RFC 6761 §6.3](https://www.rfc-editor.org/rfc/rfc6761.txt)).

But the seven "Domain Name Reservation Considerations" are almost entirely **SHOULD**, not
MUST:

| Actor | Requirement level (verbatim) |
| --- | --- |
| Users | *"Users may assume that IPv4 and IPv6 address queries for localhost names will always resolve to the respective IP loopback address."* |
| Application software | *"**MAY** recognize localhost names as special, or **MAY** pass them to name resolution APIs as they would for other domain names."* |
| Name resolution APIs and libraries | *"**SHOULD** recognize localhost names as special and **SHOULD** always return the IP loopback address…"* |
| Caching DNS servers | *"**SHOULD** recognize localhost names as special and **SHOULD NOT** attempt to look up NS records for them…"* |
| Authoritative DNS servers | *"**SHOULD** recognize localhost names as special…"* |
| DNS server operators | *"**SHOULD** be aware that the effective RDATA for localhost names is defined by protocol specification…"* |
| DNS Registries/Registrars | *"**MUST NOT** grant requests to register localhost names in the normal way…"* |

The only MUST binds registrars. **Nothing in RFC 6761 obliges a resolver or a browser to map
`content.localhost` to loopback.** The user-facing "may assume" in point 1 is an expectation,
not a conformance requirement on anyone.

The document that *does* state it as a requirement — `draft-ietf-dnsop-let-localhost-be-localhost`,
which Chromium's source cites by name and which W3C Secure Contexts references normatively —
**expired without ever becoming an RFC**. Latest revision 02, 2017-12-18; datatracker status:
*"This Internet-Draft is no longer active."*
([datatracker](https://datatracker.ietf.org/doc/draft-ietf-dnsop-let-localhost-be-localhost/)).

So `*.localhost` works because three browser vendors independently decided to implement an
expired draft. It is de-facto behaviour with excellent coverage, not a standard guarantee.

## Per-browser resolution

Does an arbitrary label like `content.localhost` resolve to loopback with **no** `/etc/hosts`
entry and **no** configuration?

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| **Chrome** | ✅ In-browser, OS never consulted [1] | ✅ same code [1] | ✅ same code [1] |
| **Edge** | ✅ same Chromium code [1] | ✅ same Chromium code [1] | ✅ same Chromium code [1] |
| **Firefox** | ✅ In-browser since **84** [2] | ✅ since **84** [2] | ✅ since **84** [2] |
| **Safari** | ⚠️ **Only macOS 26 Tahoe and later** [3] | n/a | n/a (WebKitGTK ✅ [4]) |
| *OS resolver alone* | ❌ ≤ macOS 15; ✅ macOS 26 [5] | ❓ unsourced for subdomains [6] | ✅ on systemd distros [7] |

**[1] Chrome / Edge — in-browser, resolved before anything else.** `net::IsLocalHostname()`
strips a trailing dot and returns true for `localhost` or anything ending `.localhost`,
case-insensitively
([`net/base/url_util.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/url_util.cc)):

```cpp
bool IsNormalizedLocalhostTLD(std::string_view host) {
  return base::EndsWith(host, ".localhost", base::CompareCase::INSENSITIVE_ASCII);
}
bool IsLocalHostname(std::string_view host) {
  if (!host.empty() && *host.rbegin() == '.') host.remove_suffix(1);
  return base::EqualsCaseInsensitiveASCII(host, "localhost") ||
         IsNormalizedLocalhostTLD(host);
}
```

`ResolveLocalHostname()` then synthesizes `::1` **then** `127.0.0.1`, and
`HostResolverManager` calls `ServeLocalhost()` *before* the cache lookups and before any
HOSTS-file or system-resolver task
([`net/dns/host_resolver_manager.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/dns/host_resolver_manager.cc)):

```cpp
// Special-case localhost names, as per the recommendations in
// https://tools.ietf.org/html/draft-west-let-localhost-be-localhost.
std::optional<HostCache::Entry> resolved =
    ServeLocalhost(job_key.host.GetHostname(), job_key.query_types, ...);
if (resolved) return resolved.value();
```

That ordering means Chrome **ignores `/etc/hosts` for `.localhost` names entirely** — they
never reach the OS. The behaviour was announced in Mike West's Intent to Implement and Ship
on blink-dev, 2017-08-21: *"I intend to treat `localhost.` and everything falling within
`.localhost.` as secure (after ensuring that they resolve to loopback)"*, and *"we'll also be
ensuring that `localhost` does not use any searchlist that might be configured"*
([blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/RC9dSw-O3fE/m/E3_0XaT0BAAJ),
[Chrome Platform Status 6269417340010496](https://chromestatus.com/feature/6269417340010496)).
*Could not source an exact Chrome milestone number* — the Intent names none, the platform-status
entry carries no milestone, and the original crbug (510124) did not survive the migration to
`issues.chromium.org`. "Since 2017" is the honest statement.

**[2] Firefox — in-browser since 84.** `IsLoopbackHostname()` matches `localhost`,
`localhost.`, `*.localhost`, and `*.localhost.`
([`netwerk/dns/DNS.cpp`](https://github.com/mozilla-firefox/firefox/blob/main/netwerk/dns/DNS.cpp)),
and `nsHostResolver::ResolveHost` short-circuits on it before touching the record DB
([`netwerk/dns/nsHostResolver.cpp`](https://github.com/mozilla-firefox/firefox/blob/main/netwerk/dns/nsHostResolver.cpp)):

```cpp
// Fast paths: resolve directly without touching the record DB.
if (IS_ADDR_TYPE(type) && IsLoopbackHostname(host)) {
  result = InitLoopbackRecord(key, &initRv);
```

`InitLoopbackRecord` emits `127.0.0.1` **then** `::1` (reversed by `network.dns.preferIPv6`).
Shipped via [Bugzilla 1220810](https://bugzilla.mozilla.org/show_bug.cgi?id=1220810),
*"Consider hardcoding localhost names to the loopback address"*, **RESOLVED FIXED, Target
Milestone: Firefox 84 Branch**, landed October 2020 after ~4 years.
[Bugzilla 1433933](https://bugzilla.mozilla.org/show_bug.cgi?id=1433933), *"Firefox doesn't
handle `*.localhost` domains (loopback)"*, is RESOLVED DUPLICATE of it.

**`network.dns.localDomains` is a different thing and must not be confused with the above.**
It is an *exact-match* comma-separated allowlist read into a hash set, tested by
`nsDNSService::IsLocalDomain` with `mLocalDomains.Contains(aHostname)`
([`netwerk/dns/nsDNSService2.cpp`](https://github.com/mozilla-firefox/firefox/blob/main/netwerk/dns/nsDNSService2.cpp)).
No wildcards, no suffix matching, empty by default. It is a manual override, not the
`.localhost` mechanism. A third pref, `network.proxy.allow_hijacking_localhost`, *disables*
the loopback-trustworthiness treatment for proxy-testing scenarios.

**[3] Safari — the crux.** WebKit has no resolver of its own and does not special-case
`.localhost`. [WebKit bug 160504](https://bugs.webkit.org/show_bug.cgi?id=160504),
*"Localhost subdomains don't work"*, filed **2016-08-03**, sat open for nine years. Apple's
Alexey Proskuryakov, comment #5 (2022-08-20):

> This is mostly something to fix in underlying networking libraries. As long as
> "ping mysite.localhost" doesn't work in Terminal, I wouldn't expect Safari to behave any
> differently.

Comment #16 (2024-01-01) documents the actual fallthrough path — `/etc/hosts` (which has no
wildcards), then whatever DNS server the network interface hands you, *"dependent on the good
graces of your ISP or router hardware… that seems to be hit-and-miss"*. Comment #12 records
the workaround people actually use: a literal `127.0.0.1 sub.localhost` line in
`/private/etc/hosts`.

The bug was closed **RESOLVED / MOVED on 2025-09-19**. Comment #19:

> This seems to be fixed in macOS 26 Tahoe ✅ … In macOS 15.7: It fails with "Safari can't
> find the server "foo.bar.localhost"". In macOS 26.0: It works 🎉

Comment #20, ap@webkit.org: *"Indeed, this was implemented in OS frameworks below WebKit."*

**[5] Corroborated in Apple's own published source.** `mDNS_StartQuery_internal` in
mDNSResponder now rewrites any subdomain of `localhost` to `localhost` before the query goes
anywhere:

```c
// If subdomain of localhost, rewrite qname as localhost
if (IsSubdomain(&question->qname, &localhostdomain))
{
    AssignDomainName(&question->qname, &localhostdomain);
}
```

…and `AnswerNewQuestion` refuses to escalate a `localhost` question to DNS, citing RFC 6761
§6.3 directly: *"return a negative result since we never send a localhost query to DNS
resolvers"*. That rewrite is present in
[`mDNSResponder-2881.0.25`](https://github.com/apple-oss-distributions/mDNSResponder/blob/mDNSResponder-2881.0.25/mDNSCore/mDNS.c)
and later, and **absent** from `mDNSResponder-2600.140.3` and `mDNSResponder-2559.80.8` (the
macOS 15 and macOS 14 vintages) — verified by grepping the file at each tag. Consistent with
this, Apple's `Libinfo-600` `si_getaddrinfo.c` still only does an exact
`strcmp(node, "localhost")`, i.e. nothing above mDNSResponder handles the subdomain case.

Two things follow. First, this is an **OS-version boundary, not a Safari-version boundary** —
updating Safari on macOS 15 does not help. Second, **iOS is not independently sourced.**
mDNSResponder is shared Darwin code and iOS 26 shipped from the same tree, so it is very
likely fixed there too, but no primary source confirms it and no test was run. Treat iOS as
unknown.

Also open: [WebKit bug 171934](https://bugs.webkit.org/show_bug.cgi?id=171934), *"Don't treat
loopback addresses (127.0.0.0/8, ::1/128, localhost, .localhost) as mixed content"*, status
**NEW** as of its last comment. That bug is about *potentially-trustworthy* / secure-context
treatment, a separate axis from resolution. Practical consequence: even where
`content.localhost` resolves in Safari, **do not assume `http://content.localhost` is a secure
context there** — anything gated on secure context (Service Workers, `crypto.subtle`) may be
unavailable in the content Origin under Safari. W3C Secure Contexts makes this conditional
explicitly: the localhost carve-out applies only *"If the user agent conforms to the name
resolution rules in [let-localhost-be-localhost]"*
([Secure Contexts §is-origin-trustworthy](https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy)).

**[4] WebKitGTK** is unaffected — WebKit bug 160504 comments #4 and #7 report the test case
working there, which follows from [7].

**[6] Windows.** Microsoft's documented special case covers `localhost` *itself*, not
subdomains: the default `hosts` file ships with `127.0.0.1 localhost` and `::1 localhost`
**commented out**, annotated *"localhost name resolution is handled within DNS itself"*
([Microsoft Support](https://support.microsoft.com/en-us/topic/how-to-reset-the-hosts-file-back-to-the-default-c2a43f9d-e176-c6f3-e4ef-3500277a6dae)).
**No primary Microsoft source was found stating that the Windows DNS Client extends this to
`*.localhost`**, and the `hosts` file matches exact names only. Assume it does not.

This is **moot for browsers on Windows**: Chrome, Edge, and Firefox all resolve `.localhost`
in-process before the OS resolver is reached ([1], [2]), and Safari does not exist on Windows.
It is *not* moot for non-browser clients on Windows — `curl`, Node's `dns.lookup`, a Go
HTTP client — which go through `getaddrinfo` and will likely fail. Relevant if Scholia ever
has a CLI or MCP path that fetches its own content Origin by name.

**[7] Linux.** glibc does not special-case `.localhost`. systemd does:
`is_localhost()` in `src/basic/hostname-util.c` matches `localhost`, `localhost.`,
`localhost.localdomain`, and the `.localhost` / `.localhost.` / `.localhost.localdomain`
suffixes, *"described in RFC6761 plus the redhatism of localdomain"*
([systemd source](https://github.com/systemd/systemd/blob/main/src/basic/hostname-util.c)).
So on a systemd distro the OS resolver handles it too, which is the likely explanation for
WebKitGTK working. On a non-systemd distro, browsers still work via [1]/[2].

## Origin semantics

Four isolation surfaces. `http://content.localhost:3000` vs `http://localhost:3000`:

**1. DOM access / same-origin policy — separated.** An origin is *"A tuple consisting of: A
scheme (an ASCII string). A host (a host). A port (null or a 16-bit unsigned integer). A
domain (null or a domain)."* Two origins are same origin iff *"both are tuple origins with
identical schemes, hosts, and ports."* The hosts differ, so they are not same origin, and the
parent cannot reach into `contentWindow.document` nor the frame into `parent.document`. The
spec is blunt about what that means: *"Origins are the fundamental currency of the web's
security model. Two actors… that share an origin are assumed to trust each other… Actors with
differing origins are considered potentially hostile versus each other."*
([HTML §7.5 Origin](https://html.spec.whatwg.org/multipage/browsers.html#concept-origin))

Note `same origin-domain` — the `document.domain` relaxation — cannot bridge these two either:
it requires *"domains are identical and non-null"*, and `document.domain = "localhost"` from
`content.localhost` would be setting a domain that is not a registrable-domain suffix (see the
cookie section; the same public-suffix arithmetic applies).

**2. `postMessage` — separated and directional.** *"If the targetOrigin argument is not a
single literal U+002A ASTERISK character (`*`) and targetWindow's associated Document's origin
is not same origin with targetOrigin, then return"* — a mismatched target silently drops the
message. On receipt, *"Let origin be incumbentSettings's origin"*, i.e. `event.origin` is the
*sender's* serialized origin, so the anchoring bridge on each side can pin the other exactly.
The spec's own advice matches what ADR-0003's bridge needs: *"Authors should not use the
wildcard keyword (`*`) in the targetOrigin argument in messages that contain any confidential
information"*, and authors must *"check the origin attribute to ensure that messages are only
accepted from domains that they expect to receive messages from"*
([HTML §9.4 Web messaging](https://html.spec.whatwg.org/multipage/web-messaging.html)).

**3. Storage — separated.** *"A storage key is a tuple consisting of an origin."* The
registered storage endpoints keyed by it are `localStorage`, `sessionStorage`, `indexedDB`,
`caches`, and `serviceWorkerRegistrations`
([Storage §4.1–4.2](https://storage.spec.whatwg.org/#storage-keys)). Distinct origins ⇒
distinct storage keys ⇒ distinct buckets. This is what protects the **Viewer** identity, which
ADR-0018 / `CONTEXT.md` place in `localStorage` (id + secret) on the app Origin: untrusted Page
content on the content Origin cannot read it.

**4. Cookies — *not* separated by origin.** See below. This is the one surface where "distinct
origin" is not the right mental model.

## The cookie caveat

Cookies predate origins and are keyed by host and domain, ignoring both scheme and port.
RFC 6265 §8.5 says so directly: *"Cookies do not provide isolation by port. If a cookie is
readable by a service running on one port, the cookie is also readable by a service running on
another port of the same server."* Scheme isolation is likewise absent
([RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265.html)).

The question that matters: **can `content.localhost` set a `Domain=.localhost` cookie that
`localhost` then reads?** By the bare `domain-match` algorithm (§5.1.3 — identical strings, or
the domain is a dot-preceded suffix of the string) it would match. The guard is §4.1.2.3:
*"For security reasons, many user agents are configured to reject Domain attributes that
correspond to 'public suffixes'."*

**Is `localhost` a public suffix?** Not by listing — the Public Suffix List contains **no**
entry for `localhost`, `*.localhost`, `!localhost`, `local`, `localdomain`, or `test`; verified
by grepping the raw list (snapshot `VERSION: 2026-07-25_14-20-03_UTC`, commit `e1b8015c`, 16,409
lines, zero occurrences of the string `localhost`). But it is a public suffix **by algorithm**.
The PSL matching rules are explicit
([publicsuffix.org / list wiki Format](https://github.com/publicsuffix/list/wiki/Format)):

> 1. Match domain against all rules and take note of the matching ones.
> 2. **If no rules match, the prevailing rule is `*`.**
> …
> 7. The registered or registrable domain is the public suffix plus one additional label.

No rule matches `content.localhost`, so the prevailing rule is `*`, the public suffix is
`localhost`, and the registrable domain is `content.localhost`. Both engines implement it:

- **Chromium.** `GetDomainAndRegistry` is documented to treat an unknown TLD as the registry —
  *"http://foo.bar/file.html -> "foo.bar" (no rule; assume bar)"* and *"http://bar/file.html ->
  "" (no subcomponents)"*
  ([`registry_controlled_domain.h`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/registry_controlled_domains/registry_controlled_domain.h)).
  `GetCookieDomainWithString` requires the URL's domain+registry and the cookie domain's
  domain+registry to be equal, *"Can't set a cookie on a different domain + registry"*, and
  otherwise records `EXCLUDE_DOMAIN_MISMATCH`
  ([`net/cookies/cookie_util.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/cookies/cookie_util.cc)).
  `content.localhost` → `content.localhost`; `.localhost` → `""`. Mismatch. **Rejected.**
- **Gecko.** `CookieParser::FixDomain` only accepts the `Domain` attribute when
  `IsSubdomainOf(cookieHost, aBaseDomain) && IsSubdomainOf(hostFromURI, cookieHost)`
  ([`netwerk/cookie/CookieParser.cpp`](https://github.com/mozilla-firefox/firefox/blob/main/netwerk/cookie/CookieParser.cpp)).
  The base domain of `content.localhost` is `content.localhost` (same `*`-rule arithmetic), and
  `localhost` is not a subdomain of it, so the first test fails and the comment notes *"the
  Validator will reject the cookie with the correct reason."* **Rejected.**

The reverse direction is closed by default: a cookie set by `localhost` with no `Domain`
attribute is a host-only cookie and is sent only when the request host equals it exactly, so it
never reaches `content.localhost`.

**Practical consequence for Scholia.** The cookie surface is *adequate* but not *load-bearing*,
and three residual holes decide the design:

1. **Port and scheme are ignored.** Two Scholia processes on different ports — or a user's
   unrelated dev server on `localhost:5173` — share the `localhost` cookie jar. A second
   Local Preview is not isolated from the first by port.
2. **A sibling naming scheme would leak.** `a.content.localhost` and `b.content.localhost` share
   the registrable domain `content.localhost` and *can* set cookies for each other. If per-Page
   or per-Site origin isolation is ever wanted (the IPFS subdomain-gateway shape), the isolating
   label must be attached such that each isolated unit is its own registrable domain — i.e.
   `<hash>.localhost`, not `<hash>.content.localhost`.
3. **Safari/CFNetwork was not verified.** The two engines above were read at source; WebKit's
   cookie store is CFNetwork's and is not open source. *No primary source found.* Assume nothing.

Therefore: **Local Preview must not authenticate or identify anything via cookies.** The Viewer
secret stays in `localStorage` (origin-keyed, surface 3), the Sidecar write path is authorized
by position on the filesystem (ADR-0022) rather than by a bearer cookie, and the anchoring
bridge carries no credential — it carries selections and Anchor coordinates over `postMessage`
with an explicit `targetOrigin`. Under those rules the cookie caveat costs nothing.

## portless

[portless](https://portless.sh) ([vercel-labs/portless](https://github.com/vercel-labs/portless))
maps named `.localhost` URLs to dev servers. Read from its README and `packages/portless/src`.

**How it works.** A reverse proxy on **port 443** by default, HTTPS with HTTP/2: *"On first
run, portless generates a local CA, trusts it, and binds port 443 (auto-elevates with sudo on
macOS/Linux)"*. The child app is spawned with `PORT` set to a random port in **4000–4999**,
plus `HOST`, `PORTLESS_URL` (the public URL), and `NODE_EXTRA_CA_CERTS` pointing at the local
CA. Outside `--lan` the proxy binds only `127.0.0.1` and `::1`. Subdomain routing is **strict by
default** — only explicitly registered names route; `--wildcard` is needed for
`tenant1.myapp.localhost` to fall back to the `myapp` app. It also **auto-syncs `/etc/hosts`**
for its route hostnames, and its own `--help` says why:

> **Safari / DNS:** `.localhost` subdomains auto-resolve in Chrome, Firefox, and Edge. Safari
> relies on the system DNS resolver, which may not handle them. Auto-syncs `/etc/hosts` for
> route hostnames by default…

(An independent confirmation of finding [3], from a tool shipped in 2026.)

**What the app sees.** `proxy.ts` copies the incoming headers wholesale
(`{ ...req.headers }`), so the **original `Host` survives**; for HTTP/2 it restores `Host` from
`:authority` after stripping pseudo-headers, with the comment *"so Host-dependent backends
(multi-tenant vhosts, framework host allow-lists) see the original hostname instead of
127.0.0.1."* On top of that it sets `x-forwarded-for`, `x-forwarded-proto`, `x-forwarded-host`,
`x-forwarded-port` (existing values are appended to / preserved), and `x-portless-hops` for
loop detection.

**What compatibility concretely requires of Scholia.** All of it is cheap, and all of it is
good hygiene regardless:

1. **Honour `PORT`** (and `HOST`) from the environment for the Local Preview listener. Do not
   hardcode a port and do not fail when the port is chosen for us.
2. **Derive every absolute URL from the request**, never from the bind address. Order:
   `X-Forwarded-Host` → `Host` → the bind address; scheme from `X-Forwarded-Proto` → the socket.
   This governs the Share/Preview URL printed to the terminal, the iframe `src`, the Standalone
   link, and the `postMessage` `targetOrigin` on both sides.
3. **Never assume `http:`.** Under portless the Preview is `https:` by default. Anything that
   hardcodes `http://localhost:${port}` breaks, and any `SameSite`/`Secure` reasoning has to be
   computed, not literal.
4. **Derive the content Origin as a label prepended to the *observed* host**, not to a literal
   `localhost` — `content.` + observed host. Under portless that yields
   `content.myapp.localhost`, which is a route portless does **not** know about; it needs either
   a second registered route or `--wildcard`. Worth documenting in the compatibility note; it is
   the one place where the two-Origin design and portless's strict mode collide.
5. **Trust nothing from `X-Forwarded-*`** for authorization. ADR-0022 already makes `POST /__open`
   loopback-only and unconditional; a forwarded header must not be able to talk it out of that.

**Why Scholia must never depend on portless.** A global `npm install -g`, a `sudo` auto-elevation,
a CA injected into the system keychain, port 443, and writes to `/etc/hosts` are — individually
— each fatal to `npx scholia ./docs`, which promises no account, no token, no network, and no
setup (ADR-0010, `CONTEXT.md` "Local Preview"). Together they are a different product. portless
is a *nice thing a user may already have*; the boundary Scholia relies on must exist without it.

## Open questions / what could not be sourced

- **The exact Chrome milestone.** The 2017 blink-dev Intent names none, the Chrome Platform
  Status entry has no milestone, and crbug 510124 did not survive the issue-tracker migration
  (`issues.chromium.org` returns *"Issue 510124 does not exist"*; the modern tracker requires
  sign-in for history). "Chrome has done this since 2017, and the code is in `main` today" is
  what can be defended.
- **iOS / iPadOS.** No primary source that iOS 26 carries the mDNSResponder change, and no
  device was tested. Inferred from shared Darwin sources only.
- **No Apple release note.** The macOS 26 behaviour change is sourced from (a) WebKit bug 160504
  comments #19/#20, one of which is an Apple engineer's confirmation, and (b) a diff of Apple's
  published mDNSResponder tags. Apple published no release note naming it; searching the macOS
  Tahoe 26.x developer release notes surfaced nothing.
- **Windows DNS Client and `*.localhost`.** Microsoft documents the special case for `localhost`
  only. Nothing found either way about subdomains. Untested.
- **Safari/CFNetwork cookie domain handling.** Not open source; the public-suffix arithmetic
  above is verified for Chromium and Gecko only.
- **`http://*.localhost` as a secure context in Safari.** WebKit bug 171934 is still NEW and the
  Secure Contexts carve-out is conditional on resolution conformance. Unknown even on macOS 26.
- ~~**Not empirically tested.**~~ Chrome 150 and Firefox 152 were subsequently driven against a
  purpose-built probe — see [Empirical results](#empirical-results) below. Safari on macOS ≤ 15
  remains untested and is the one claim here still resting entirely on secondary evidence.

## Empirical results

Measured 2026-07-28 with a throwaway probe (`packages/local/prototype/localhost-origin-probe/`,
issue #23): one Hono listener on port 4123, routed by `Host`, serving a viewer on
`http://localhost:4123` and content on `http://content.localhost:4123`. No proxy, no TLS, no
configuration. Probes ran against a **plain, unsandboxed** iframe so that the hostname boundary
was the only variable, and were then repeated under `sandbox="allow-scripts"`.

| Probe | Chrome 150 (macOS 26) | Firefox 152 (macOS 26) |
|---|---|---|
| `content.localhost` resolves | ✅ | ✅ |
| Viewer reads frame `document` / `location` | ❌ `SecurityError` | ❌ `SecurityError` |
| Frame reads parent `document` / `top.location` | ❌ `SecurityError` | ❌ `SecurityError` |
| `event.origin` at the viewer | `http://content.localhost:4123` | `http://content.localhost:4123` |
| Message with wrong `targetOrigin` | dropped | dropped |
| localStorage / sessionStorage / IndexedDB cross-read | `null` — partitioned | `null` — partitioned |
| `Domain=localhost` / `Domain=.localhost` cookies | **all four rejected** | **all four rejected** |
| Cookies reaching the viewer host | none | none |
| `document.domain` relaxation from content | ❌ threw | ❌ threw |
| DOM access after both sides relaxed | ❌ still blocked | ❌ still blocked |
| `isSecureContext` on **both** hosts, over plain HTTP | ✅ `true` | ✅ `true` |
| Under `sandbox="allow-scripts"`: `event.origin` | `"null"` | `"null"` |
| Under sandbox: storage + `document.cookie` | ❌ `SecurityError` | ❌ `SecurityError` |

Four results are worth carrying into the ADR:

1. **Chrome states the public-suffix reasoning in its own error text.** Relaxing `document.domain`
   from the content Origin failed with *"Failed to set the 'domain' property on 'Document':
   'localhost' is a top-level domain."* That is the engine independently confirming the PSL
   default-`*`-rule arithmetic derived above — the same rule that rejects the `Domain=` cookies.
   Firefox refuses the same operation as *"The operation is insecure."*
2. **The cookie caveat is closed, but for a reason worth stating.** No `Domain=`-widened cookie was
   accepted by either engine, so the content Origin cannot plant a cookie the viewer host will
   read. Only host-only cookies survived, and they stayed on `content.localhost`.
3. **Third-party cookie policy differs between the engines, and it is not the boundary.** Chrome
   dropped the default-`Lax` host-only cookie in the embedded frame and kept only
   `SameSite=None; Secure`; Firefox kept both. This is third-party cookie handling, not origin
   isolation — worth knowing when Local Preview sets cookies, and not evidence about the boundary
   either way.
4. **`http://content.localhost` is a secure context with no TLS.** Both hosts reported
   `isSecureContext: true`, so the content Origin gets `crypto.subtle`, service workers, and the
   rest of the secure-context surface for free. (Still unknown for Safari — WebKit bug 171934.)

One incidental finding, from noise rather than design: the viewer's cookie jar in Chrome already
contained a `__stripe_mid` cookie set by an unrelated project on `localhost`. Cookies ignore port,
so **`localhost` is a single shared cookie jar across every dev server on the machine**. Local
Preview should therefore keep nothing sensitive in cookies on the viewer Origin — not because the
content Origin can reach them, but because every other localhost project can.

## Recommendation

**Keep cross-origin. ADR-0003 holds in Local Preview — do not make Local Preview architecturally
special — but implement the content Origin with a runtime capability probe and an explicit,
visible same-origin fallback.**

The reasoning, in order:

1. **The boundary is real where it resolves.** Distinct host ⇒ distinct origin ⇒ DOM, storage,
   and `postMessage` isolation by spec, and the cookie direction that would have broken it is
   closed by the PSL default rule in both engines. One Hono listener, routed by `Host`, serves
   both Origins on one port. There is no proxy, no TLS, and no configuration. This is exactly the
   property the spike was asking about, and the answer is yes.

2. **Keeping one isolation model is worth real effort.** ADR-0003's argument was that a single
   iframe + a single anchoring bridge beats maintaining two content paths. If Local Preview went
   same-origin, Scholia would have two security models, two bridge behaviours, and a class of bug
   that only appears hosted — precisely when it is least recoverable. ADR-0020's shared application
   layer and ADR-0022's "the local server already *is* the application" both push the same way.

3. **The `sandbox` attribute is the load-bearing guarantee; the distinct host is the second
   layer.** An `<iframe sandbox="allow-scripts">` without `allow-same-origin` already forces an
   **opaque origin** — *"the content is treated as being from a unique opaque origin"* — with no
   DNS involvement in any browser on any OS
   ([HTML §4.8.5](https://html.spec.whatwg.org/multipage/iframe-embed-object.html)). Note the
   spec's warning that `allow-scripts` + `allow-same-origin` on same-origin content lets the frame
   *"simply remove the sandbox attribute and then reload itself"* — which is exactly why a naive
   same-origin Local Preview would be worse than it looks. So the fallback is not "no isolation";
   it is "isolation without a distinct host", which is weaker (no Standalone, no defence in depth
   if a sandbox flag is ever mis-set) but not nothing.

4. **But the distinct host is genuinely load-bearing for Standalone.** `CONTEXT.md` defines
   **Standalone** as a Page *"served from the content origin as the bytes themselves"* with no
   Scholia chrome — a **top-level** document. A parent cannot sandbox a top-level navigation; only
   a `Content-Security-Policy: sandbox` header could, and that would break the Page's own
   sub-resources and defeat the point. Standalone is therefore only safe if the content Origin is
   a genuinely different host. This, not the iframe, is why `*.localhost` matters.

5. **Safari on macOS ≤ 15 fails hard, and that is a product problem, not a security one.** The
   failure mode is "Safari can't find the server", i.e. a blank Page in the default browser of a
   user who typed `npx scholia ./docs`. Zero-config is the promise (ADR-0010). Telling that user
   to edit `/private/etc/hosts` is the opposite of the promise, and writing `/etc/hosts` ourselves
   (portless's answer) requires `sudo` and is equally out of bounds. Hence the probe: the viewer
   attempts a tiny same-port request to the content Origin on load, and on failure or timeout
   falls back to serving Page content from a path on the app Origin, still sandboxed without
   `allow-same-origin`, with Standalone links disabled and a quiet, honest notice that content
   isolation is reduced on this browser. The fallback is Safari-shaped and time-limited: it
   retires as macOS 26 adoption completes.

6. **Do not build on portless, do stay compatible with it.** The five requirements above are all
   things a well-behaved server does anyway.

The one thing to write into the ADR that follows: **`*.localhost` is de-facto behaviour
implementing an expired Internet-Draft, not a standard guarantee** (RFC 6761 only says SHOULD, to
resolvers, and the draft that says MUST expired in 2017). Design so that losing it degrades the
product rather than breaking it — which the probe-and-fallback does, and which a hard dependency
would not.

## Sources

**RFCs and drafts**
- RFC 6761, *Special-Use Domain Names*, §6.3 — https://www.rfc-editor.org/rfc/rfc6761.txt
- RFC 6265, *HTTP State Management Mechanism*, §4.1.2.3, §5.1.3, §8.5 — https://www.rfc-editor.org/rfc/rfc6265.html
- `draft-ietf-dnsop-let-localhost-be-localhost` (expired, rev 02, 2017-12-18) — https://datatracker.ietf.org/doc/draft-ietf-dnsop-let-localhost-be-localhost/

**Specifications**
- HTML Standard, §7.5 Origin — https://html.spec.whatwg.org/multipage/browsers.html#concept-origin
- HTML Standard, §9.4 Web messaging (`postMessage`, `MessageEvent.origin`) — https://html.spec.whatwg.org/multipage/web-messaging.html
- HTML Standard, §4.8.5 The `iframe` element (`sandbox`, `allow-same-origin`) — https://html.spec.whatwg.org/multipage/iframe-embed-object.html
- URL Standard (special schemes, default ports) — https://url.spec.whatwg.org/
- Storage Standard, §4.1 Storage endpoints, §4.2 Storage keys — https://storage.spec.whatwg.org/#storage-keys
- W3C Secure Contexts, *Is origin potentially trustworthy?* — https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy

**Chromium**
- `net/base/url_util.cc` (`IsLocalHostname`, `IsNormalizedLocalhostTLD`) — https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/url_util.cc
- `net/dns/host_resolver_manager.cc` (`ResolveLocalHostname`, `ServeLocalhost`) — https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/dns/host_resolver_manager.cc
- `net/cookies/cookie_util.cc` (`GetCookieDomainWithString`, `GetEffectiveDomain`) — https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/cookies/cookie_util.cc
- `net/base/registry_controlled_domains/registry_controlled_domain.h` — https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/registry_controlled_domains/registry_controlled_domain.h
- blink-dev, *Intent to Implement and Ship: Treat `http://localhost` as a secure context*, Mike West, 2017-08-21 — https://groups.google.com/a/chromium.org/g/blink-dev/c/RC9dSw-O3fE/m/E3_0XaT0BAAJ
- Chrome Platform Status, feature 6269417340010496 — https://chromestatus.com/feature/6269417340010496

**Mozilla**
- Bugzilla 1220810, *Consider hardcoding localhost names to the loopback address* (FIXED, Firefox 84) — https://bugzilla.mozilla.org/show_bug.cgi?id=1220810
- Bugzilla 1433933, *Firefox doesn't handle `*.localhost` domains (loopback)* (DUPLICATE of 1220810) — https://bugzilla.mozilla.org/show_bug.cgi?id=1433933
- `netwerk/dns/DNS.cpp` (`IsLoopbackHostname`) — https://github.com/mozilla-firefox/firefox/blob/main/netwerk/dns/DNS.cpp
- `netwerk/dns/nsHostResolver.cpp` (`InitLoopbackRecord`, fast path) — https://github.com/mozilla-firefox/firefox/blob/main/netwerk/dns/nsHostResolver.cpp
- `netwerk/dns/nsDNSService2.cpp` (`network.dns.localDomains`, `IsLocalDomain`) — https://github.com/mozilla-firefox/firefox/blob/main/netwerk/dns/nsDNSService2.cpp
- `netwerk/cookie/CookieParser.cpp` (`FixDomain`) — https://github.com/mozilla-firefox/firefox/blob/main/netwerk/cookie/CookieParser.cpp
- `netwerk/cookie/CookieCommons.cpp` (`GetBaseDomain`) — https://github.com/mozilla-firefox/firefox/blob/main/netwerk/cookie/CookieCommons.cpp

**WebKit / Apple**
- WebKit bug 160504, *Localhost subdomains don't work* (2016-08-03 → RESOLVED MOVED 2025-09-19) — https://bugs.webkit.org/show_bug.cgi?id=160504
- WebKit bug 171934, *Don't treat loopback addresses… as mixed content* (NEW) — https://bugs.webkit.org/show_bug.cgi?id=171934
- `mDNSResponder-2881.0.25`, `mDNSCore/mDNS.c` (localhost subdomain rewrite; RFC 6761 negative response) — https://github.com/apple-oss-distributions/mDNSResponder/blob/mDNSResponder-2881.0.25/mDNSCore/mDNS.c
- `mDNSResponder-2600.140.3`, `mDNSCore/mDNS.c` (rewrite absent) — https://github.com/apple-oss-distributions/mDNSResponder/blob/mDNSResponder-2600.140.3/mDNSCore/mDNS.c
- `Libinfo-600`, `lookup.subproj/si_getaddrinfo.c` — https://github.com/apple-oss-distributions/Libinfo

**Microsoft**
- *How to reset the Hosts file back to the default* (default hosts file; "localhost name resolution is handled within DNS itself") — https://support.microsoft.com/en-us/topic/how-to-reset-the-hosts-file-back-to-the-default-c2a43f9d-e176-c6f3-e4ef-3500277a6dae

**Public Suffix List**
- Raw list (checked at `VERSION: 2026-07-25_14-20-03_UTC`, commit `e1b8015c`) — https://publicsuffix.org/list/public_suffix_list.dat
- Format and algorithm (rule 2: *"If no rules match, the prevailing rule is `*`"*) — https://github.com/publicsuffix/list/wiki/Format
- List overview — https://publicsuffix.org/list/

**systemd**
- `src/basic/hostname-util.c` (`is_localhost`) — https://github.com/systemd/systemd/blob/main/src/basic/hostname-util.c

**portless**
- Site — https://portless.sh
- Repository (README, `packages/portless/src/proxy.ts`, `cli.ts`, `hosts.ts`) — https://github.com/vercel-labs/portless
