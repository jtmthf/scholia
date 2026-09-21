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
    binds loopback on both stacks, which means _any_ page in the user's browser can
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
was never implemented). A fixed probe order opens whichever editor is _installed_ first,
not the one the user is _using_ — the common failure being a Cursor user whose files open
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
config acceptable in a zero-config tool, because it only ever appears _after_ the tool has
guessed wrong for you. The "render no button rather than a broken one" rule is unchanged.

**The endpoint is loopback-only, unconditionally** (see ADR-0022). The guard list above
rests on the server binding loopback, which a Tunnel invalidates — the "random tab"
this ADR guards against becomes a random person. Tunnelled requests are refused.

**On Windows the no-shell rule bends for `.cmd` shims, and only for them** (issue #46).
The editor CLIs there — `code.cmd`, `cursor.cmd`, `windsurf.cmd`, the JetBrains
launchers — are batch files. `CreateProcess` does not apply `PATHEXT`, so a bare
`code` is `ENOENT`, and since CVE-2024-27980 Node refuses to spawn a `.cmd` or `.bat`
without a shell at all. There is no shell-free way to run them.

The spawn goes through [`cross-spawn`](https://github.com/moxystudio/node-cross-spawn),
not hand-written quoting. It resolves the command the way `where` does, runs an `.exe`
directly, and uses `cmd.exe /d /s /c` only for a batch file — quoting each argument and
caret-escaping every cmd metacharacter, with the command line handed to Node verbatim so
it isn't re-quoted. The argument reaches the shim still quoted, so its `%*` passes it on
intact. Getting that escaping right is the library's whole job; a first attempt at our
own got three rules wrong (`%` expands inside quotes, `^` doesn't escape inside them, and
Node re-quotes a `/c` argument unless told not to), which is the argument for not owning
it.

The blast-radius argument above still holds: the path is still bounded by
`resolveWithinRoot`, and the only input that reaches the shell is the name of a file inside
the previewed directory. Off Windows, `cross-spawn` passes straight through to
`child_process.spawn` with no shell, so the guard there is unchanged. A test drives a real
`.cmd` shim with a filename carrying cmd's metacharacters and asserts the editor receives it
verbatim; CI runs it on `windows-latest`.
