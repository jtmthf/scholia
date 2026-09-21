---
"scholia": patch
---

Fix "Open in editor" on Windows. Editor CLIs there are `.cmd` shims (`code.cmd`, `cursor.cmd`), which the spawn couldn't start, so the button always reported "Couldn't open". It now spawns through `cross-spawn`, which runs a shim through `cmd.exe` with every argument escaped, and spawns an `.exe` directly.
