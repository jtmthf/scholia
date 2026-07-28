# PROTOTYPE — `*.localhost` origin probe

**Throwaway. Delete once issue #23 is answered.** No tests, no error handling
beyond what makes it run, no abstractions. Nothing here ships.

## The question

Does `http://content.localhost:PORT` give Local Preview a **genuine cross-origin
content boundary** against `http://localhost:PORT` — on one port, with no proxy,
no TLS and no configuration? If it does, local isolation stops being
architecturally special and ADR-0003's sandboxed cross-origin iframe holds
locally exactly as it does hosted. If it doesn't, Local Preview needs a
documented difference.

Origin is scheme + host + port, so the two hostnames *should* be distinct origins
on a single port. Two things could break that: the hostname might not resolve to
loopback at all (Safari is the historical doubt), or the boundary might be
real for the DOM yet leak through **cookies**, which are host/domain-scoped and
ignore both scheme and port.

## Assumption stated up front

The `/prototype` skill offers a terminal-TUI branch (logic) and a
variants-on-a-route branch (UI). Neither fits: the browser *is* the system under
test, so the answer only exists in a real browser. This follows the logic
branch's structure — question stated, probes kept separate from the shell, full
state surfaced after every run — but renders its frame as a web page instead of
a TUI.

## Run it

```sh
pnpm prototype:localhost-origin
```

Then open **http://localhost:4123** by hand in Chrome, Firefox and Safari in
turn. Everything runs on one port; the probe derives the content host from the
`Host` header it is served on, so it also works behind a proxy such as portless
(try `PORT=4123 pnpm prototype:localhost-origin` behind whatever hostname
portless assigns).

The page runs every probe on load, renders a verdict banner, and offers **Copy
report as Markdown** — paste that into the issue once per browser.

## What it probes

| # | Probe | A real boundary looks like |
|---|-------|----------------------------|
| 0 | Does `content.localhost` resolve and serve at all? | fetch succeeds |
| 1 | Cross-frame DOM access (`frame.contentWindow.document`) | throws `SecurityError` |
| 2 | `event.origin` seen on `postMessage` | `http://content.localhost:PORT` |
| 3 | Wrong `targetOrigin` is dropped | only the correctly-targeted message arrives |
| 4 | `localStorage` / `sessionStorage` / IndexedDB | each side reads only its own key |
| 5 | Cookies, incl. `Domain=localhost` from the content side | content's cookies never reach the viewer host |
| 6 | `document.domain` relaxation escape hatch | refused or ineffective |
| 7 | `window.isSecureContext` on both hosts | true without TLS (crypto/service workers) |
| 8 | Same again under `sandbox="allow-scripts"` | opaque origin — `event.origin` is `"null"` |

Probes 1–7 run on a **plain, unsandboxed** iframe on purpose. Sandboxing forces
an opaque origin, which would manufacture isolation regardless of hostname and
hide the thing being measured. Probe 8 re-runs against ADR-0003's actual
configuration, to show what the sandbox attribute adds on top of the hostname
boundary.

## Reading the cookie result

This is the probe most likely to be the real finding. The content host tries to
set six cookies: host-only, `Domain=.localhost` and `Domain=localhost`, each in
a default-`Lax` and a `SameSite=None; Secure` variant. Whether the `Domain=`
ones are accepted depends on whether `localhost` is treated as a public suffix.
If any of them show up in the **viewer's** server-visible `Cookie` header, the
origin boundary is real for the DOM but porous for cookies — and that belongs in
the ADR regardless of what the rest of the table says.
