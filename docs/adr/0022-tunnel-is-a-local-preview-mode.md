# A Tunnel is a mode of Local Preview, not a form of hosting

## Status

accepted (amends the loopback assumption in ADR-0017)

## Context & Decision

"How does someone else see this?" has three candidate answers — hosted `share`, a tunnel,
and a static drop — and they are not variations of one feature.

**A Tunnel is a flag on the local command** (`scholia <path> --tunnel`), not a form of
`share`. `share` uploads bytes, mints a Site, creates immutable Versions and returns a
durable URL. A Tunnel changes nothing except reachability: same live files, same Sidecar,
same live-reload. Grouping it under `share` would misrepresent what it does.

We sequence **Tunnel before hosting**. It is nearly free given ADR-0018 and ADR-0020 — the
local server already *is* the application, with the full Conversation surface — and it
requires no database, no blob store, no accounts, no deployment and no abuse surface. The
payoff is that a reviewer's Comments **land in the author's working tree as files**, with
no import, sync or export step.

**Access follows ADR-0001 unchanged: the unguessable URL is the gate.** A Tunnel URL grants
read and comment; it never confers ownership. Tiers are held by position — the human at the
terminal is the Owner because they hold the filesystem, and guests are Viewers. When the
tunnel runs over a tailnet, the provider's ACL is real access control maintained by
somebody else, and is the honest answer to "private sites for teams" at this stage.

We **do not build tunnel infrastructure**. Shell out to `cloudflared` / `tailscale funnel`
or use `@ngrok/ngrok`, detect what is installed, and print instructions when nothing is.

## Consequences

- **`POST /__open` must refuse tunnelled requests.** ADR-0017's guards are "POST, not GET",
  "`Sec-Fetch-Site` must be same-origin", and — load-bearing — that the server binds
  loopback only. A Tunnel invalidates the third directly. That ADR warned "without this
  check a random tab could make the editor open files"; tunnelled, it is a random *person*.
  The endpoint is loopback-only, unconditionally.
- **Local Preview becomes multi-user, which brings back the Viewer.** Git config identifies
  the author and means nothing for a guest on another machine, so tunnelled guests are
  minted Viewers with self-declared display names — exactly the existing concept, already
  built in the viewer.
- **The tunnel must be loud.** Explicitly started, clearly indicated in CLI output and in
  the UI. "My documents are on the internet" must never be a thing you forget.
- **A Tunnel is not asynchronous, and document review is.** Close the laptop and the link
  dies, so "take a look when you get a chance" is unsupported. That is precisely what
  hosting sells, which is why hosting is deferred rather than cancelled.
- **A static drop (`scholia build`) is a publishing feature, not a collaboration one** — it
  has no backend, so Comments do not work on it. Kept deliberately out of the comment
  story.
- Hosting remains built and gated. The evidence for whether to run it as a service is
  exactly what tunnelled use will generate.
