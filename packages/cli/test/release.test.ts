import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const VERSION_PACKAGES = fileURLToPath(
  new URL("../../../scripts/version-packages.mjs", import.meta.url),
);

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("a UI patch cascades through Local Preview to the published CLI", async () => {
  const fixture = await mkdtemp(`${tmpdir()}/scholia-release-plan-`);
  const repositoryConfig = JSON.parse(
    await readFile(`${REPOSITORY_ROOT}/.changeset/config.json`, "utf8"),
  );

  await mkdir(`${fixture}/.changeset`);
  await mkdir(`${fixture}/packages/ui`, { recursive: true });
  await mkdir(`${fixture}/packages/local`, { recursive: true });
  await mkdir(`${fixture}/packages/cli`, { recursive: true });
  await writeJson(`${fixture}/package.json`, {
    name: "release-plan-fixture",
    private: true,
    packageManager: "pnpm@11.7.0",
  });
  await writeFile(`${fixture}/pnpm-workspace.yaml`, "packages:\n  - packages/*\n");
  await writeJson(`${fixture}/.changeset/config.json`, {
    ...repositoryConfig,
    changelog: false,
  });
  await writeJson(`${fixture}/packages/ui/package.json`, {
    name: "@scholia/ui",
    version: "0.0.0",
    private: true,
  });
  await writeJson(`${fixture}/packages/local/package.json`, {
    name: "@scholia/local",
    version: "0.0.0",
    private: true,
    dependencies: { "@scholia/ui": "workspace:*" },
  });
  await writeJson(`${fixture}/packages/cli/package.json`, {
    name: "scholia",
    version: "0.1.2",
    devDependencies: { "@scholia/local": "workspace:*" },
  });

  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: fixture });
  await execFileAsync("git", ["config", "user.email", "release-test@scholia.test"], {
    cwd: fixture,
  });
  await execFileAsync("git", ["config", "user.name", "Scholia release test"], { cwd: fixture });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: fixture });
  await execFileAsync("git", ["add", "."], { cwd: fixture });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: fixture });
  await writeFile(
    `${fixture}/.changeset/ui-fix.md`,
    '---\n"@scholia/ui": patch\n---\n\nFix the shared comment layer.\n',
  );

  await execFileAsync(process.execPath, [VERSION_PACKAGES], { cwd: fixture });

  const versions = await Promise.all(
    ["ui", "local", "cli"].map(async (name) => {
      const manifest = JSON.parse(
        await readFile(`${fixture}/packages/${name}/package.json`, "utf8"),
      );
      return manifest.version;
    }),
  );
  expect(versions).toEqual(["0.0.1", "0.0.1", "0.1.3"]);
});

test("the release bot skips local commit hooks", async () => {
  const workflow = await readFile(`${REPOSITORY_ROOT}/.github/workflows/release.yml`, "utf8");
  const changesetsStep = workflow.slice(workflow.indexOf("- uses: changesets/action@v1"));

  expect(changesetsStep).toContain("version: pnpm release:version");
  expect(changesetsStep).toMatch(/env:\n(?: {10}.+\n)* {10}LEFTHOOK: "0"(?:\n|$)/);
});
