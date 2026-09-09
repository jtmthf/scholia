import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const changesetBin = require.resolve("@changesets/cli/bin.js");

// These private packages are inlined into dist/cli.js by packages/cli/tsup.config.ts.
// Changesets deliberately does not bump a dependent for devDependency changes, so
// preserve that honest package.json classification and bridge the release-only
// meaning here.
const bundledCliDependencies = new Set([
  "@scholia/client",
  "@scholia/core",
  "@scholia/local",
  "@scholia/sidecar",
]);

const cwd = process.cwd();
const temporaryDirectory = mkdtempSync(join(tmpdir(), "scholia-release-plan-"));
const planPath = join(temporaryDirectory, "release-plan.json");

try {
  execFileSync(process.execPath, [changesetBin, "status", `--output=${planPath}`], {
    cwd,
    stdio: "inherit",
  });
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const cliRelease = plan.releases.find((release) => release.name === "scholia");
  const bundlesChangedPackage = plan.releases.some(
    (release) => release.type !== "none" && bundledCliDependencies.has(release.name),
  );

  if (bundlesChangedPackage && (!cliRelease || cliRelease.type === "none")) {
    writeFileSync(
      join(cwd, ".changeset", "bundled-internal-dependencies.md"),
      '---\n"scholia": patch\n---\n\nInclude changes from bundled internal packages.\n',
      { flag: "wx" },
    );
  }

  execFileSync(process.execPath, [changesetBin, "version"], { cwd, stdio: "inherit" });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
