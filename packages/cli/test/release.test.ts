import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CHANGESET_BIN = createRequire(import.meta.url).resolve("@changesets/cli/bin.js");

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * A workspace shaped like the real one: `scholia` inlines its four bundled
 * packages as devDependencies, `@scholia/ui` reaches the CLI only transitively
 * through `@scholia/local`, and `@scholia/db` is hosted-only — nothing the
 * published artifact contains.
 */
async function buildFixture(changeset: string): Promise<string> {
  const fixture = await mkdtemp(`${tmpdir()}/scholia-release-plan-`);
  const repositoryConfig = JSON.parse(
    await readFile(`${REPOSITORY_ROOT}/.changeset/config.json`, "utf8"),
  );

  await mkdir(`${fixture}/.changeset`);
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

  const privatePackages: Record<string, Record<string, string>> = {
    core: {},
    db: {},
    ui: {},
    sidecar: { "@scholia/core": "workspace:*" },
    client: { "@scholia/core": "workspace:*" },
    local: { "@scholia/core": "workspace:*", "@scholia/ui": "workspace:*" },
  };
  for (const [name, dependencies] of Object.entries(privatePackages)) {
    await mkdir(`${fixture}/packages/${name}`, { recursive: true });
    await writeJson(`${fixture}/packages/${name}/package.json`, {
      name: `@scholia/${name}`,
      version: "0.0.0",
      private: true,
      dependencies,
    });
  }

  await mkdir(`${fixture}/packages/cli`, { recursive: true });
  await writeJson(`${fixture}/packages/cli/package.json`, {
    name: "scholia",
    version: "0.1.2",
    devDependencies: {
      "@scholia/client": "workspace:*",
      "@scholia/core": "workspace:*",
      "@scholia/local": "workspace:*",
      "@scholia/sidecar": "workspace:*",
    },
  });

  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: fixture });
  await execFileAsync("git", ["config", "user.email", "release-test@scholia.test"], {
    cwd: fixture,
  });
  await execFileAsync("git", ["config", "user.name", "Scholia release test"], { cwd: fixture });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: fixture });
  await execFileAsync("git", ["add", "."], { cwd: fixture });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: fixture });
  await writeFile(`${fixture}/.changeset/change.md`, changeset);

  await execFileAsync(process.execPath, [CHANGESET_BIN, "version"], { cwd: fixture });
  return fixture;
}

async function versionOf(fixture: string, directory: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(`${fixture}/packages/${directory}/package.json`, "utf8"),
  );
  return manifest.version;
}

test("a UI patch cascades through Local Preview to the published CLI", async () => {
  const fixture = await buildFixture(
    '---\n"@scholia/ui": patch\n---\n\nFix the shared comment layer.\n',
  );

  // `@scholia/ui` sits outside the fixed group and keeps its own version line;
  // it reaches the CLI through Local Preview, which is inside the group.
  expect(await versionOf(fixture, "ui")).toBe("0.0.1");
  expect(await versionOf(fixture, "local")).toBe("0.1.3");
  expect(await versionOf(fixture, "cli")).toBe("0.1.3");
});

test("a bundled feature reaches the CLI as a feature, not a fix", async () => {
  const fixture = await buildFixture('---\n"@scholia/core": minor\n---\n\nAdd a verb.\n');

  expect(await versionOf(fixture, "cli")).toBe("0.2.0");
});

test("a hosted-only change releases no CLI", async () => {
  const fixture = await buildFixture('---\n"@scholia/db": patch\n---\n\nFix a repository query.\n');

  expect(await versionOf(fixture, "db")).toBe("0.0.1");
  expect(await versionOf(fixture, "cli")).toBe("0.1.2");
});

test("the release bot skips local commit hooks", async () => {
  const workflow = await readFile(`${REPOSITORY_ROOT}/.github/workflows/release.yml`, "utf8");
  const changesetsStep = workflow.slice(workflow.indexOf("- uses: changesets/action@v1"));

  expect(changesetsStep).toContain("version: pnpm changeset version");
  expect(changesetsStep).toMatch(/env:\n(?: {10}.+\n)* {10}LEFTHOOK: "0"(?:\n|$)/);
});
