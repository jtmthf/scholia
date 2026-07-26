# Local Preview spawns the user's editor from a guarded loopback endpoint

## Status

accepted

## Context & Decision

Local Preview knows something no hosted docs site can: the absolute filesystem path of
the file it is rendering. "Open in editor" is therefore the one affordance that is
structurally unavailable to fumadocs and its peers, and the clearest expression of why
the local tool exists (ADR-0010).

Resolving a target with zero config is the hard part. A `vscode://file/{path}` anchor is
the client-side answer, but it silently does nothing for Zed, Sublime, JetBrains, or a
Cursor install that registered `cursor://` instead — and a dead button is worse than no
button. Copy-path-only is reliable but gives up the affordance.

We chose a server route, `POST /__open`, because Local Preview is already a process on
the user's machine with filesystem access and is not limited to URL schemes. It resolves
an editor by probing, in order: `$VISUAL` / `$EDITOR` when they look like a GUI binary,
then `cursor`, `code`, `zed`, `subl`, `windsurf` on `PATH`. The probe runs once at server
start and its result is passed into `renderPage`, so when nothing resolves the button is
never rendered rather than rendering broken.

## Consequences

- **A loopback server that spawns processes from a request parameter needs guarding,**
  and the guards are the reason this is written down rather than left to the reader:
  - The path is resolved through the same `resolveWithinRoot` check the page route uses,
    so a traversal cannot reach outside the served directory.
  - The route is `POST`, not `GET`, so an `<img>` or plain link cannot trigger it.
  - Requests whose `Sec-Fetch-Site` is not `same-origin` are rejected. Local Preview
    binds loopback on both stacks, which means *any* page in the user's browser can
    reach it; without this check a random tab could make the editor open files.
  - The spawn passes argv as an array with no shell, so the blast radius is bounded to
    opening a file that is already inside the previewed directory.
- Removing the endpoint later breaks a workflow people will have built a habit around,
  which is why the alternatives are recorded here rather than rediscovered.
- The probe is best-effort and deliberately silent. A user with no GUI editor on `PATH`
  sees "Copy path" in its place and is never told why — surfacing editor detection
  failures would be config-shaped, which is what this tool exists not to be.

## Amendments

**Editor resolution is environment-first** (supersedes the `PATH` probe order above, which
was never implemented). A fixed probe order opens whichever editor is *installed* first,
not the one the user is *using* — the common failure being a Cursor user whose files open
in VS Code. Resolution order is now:

1. **The invoking environment.** Scholia is nearly always launched from an editor's
   integrated terminal, which says exactly which editor that is: `TERM_PROGRAM=vscode`,
   `TERM_PROGRAM=zed`, `TERMINAL_EMULATOR=JetBrains-JediTerm`. Cursor and Windsurf are
   VS Code forks and also report `TERM_PROGRAM=vscode`, so they are discriminated by the
   application path in `VSCODE_GIT_ASKPASS_NODE` / `VSCODE_IPC_HOOK_CLI`. **That
   discrimination is the actual fix.**
2. **Repository markers** — `.vscode/`, `.idea/`, `.zed/`. A weak signal: `.vscode/` is
   committed by people who do not use VS Code.
3. **The `PATH` probe** as originally recorded, as a last resort.

An explicit `--editor` override persists to `~/.scholia/config`. This is the one piece of
config acceptable in a zero-config tool, because it only ever appears *after* the tool has
guessed wrong for you. The "render no button rather than a broken one" rule is unchanged.

**The endpoint is loopback-only, unconditionally** (see ADR-0022). The guard list above
rests on the server binding loopback, which a Tunnel invalidates — the "random tab"
this ADR guards against becomes a random person. Tunnelled requests are refused.
