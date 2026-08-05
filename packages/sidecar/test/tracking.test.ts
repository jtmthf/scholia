// Committing the Sidecar, and surviving merges (ADR-0018, ADR-0019).
//
// These run against real git repositories in temp directories, because every
// claim here is a claim about git's behaviour: that the Sidecar is invisible to
// it by default, that the opt-in makes it visible, and above all that
// `merge=union` plus a dedupe-by-event-id fold really do turn concurrent replies
// into both replies rather than a conflict. Mocking git out would leave exactly
// the part that can be wrong untested.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SidecarStore } from "../src/store.js";
import { commitSidecar, uncommitSidecar } from "../src/tracking.js";
import { isCommitted } from "../src/layout.js";

const execFile = promisify(execFileCb);

// The tests' own git calls are isolated from the developer's global config —
// a global `commit.gpgsign` or `core.hooksPath` would otherwise decide whether
// they pass. The code under test deliberately runs git as the user has it.
const ISOLATED = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
};

/** Run git in `cwd`, failing the test with git's own message if it exits non-zero. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile("git", args, { cwd, env: ISOLATED });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    throw new Error(`git ${args.join(" ")}\n${e.stderr ?? ""}${e.stdout ?? ""}`);
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

let rootDir: string;
let store: SidecarStore;

/** A committed repository with one Page in it — the state Scholia meets. */
async function initRepo(): Promise<void> {
  await git(rootDir, "init", "-b", "main");
  await writeFile(join(rootDir, "readme.md"), "# Title\n\nSome prose to comment on.\n");
  await git(rootDir, "add", "readme.md");
  await git(rootDir, "commit", "-m", "content");
}

let seq = 0;
/** A UUID-shaped id. Distinct per call, since ids are also filenames. */
function id(): string {
  seq += 1;
  return `00000000-0000-7000-8000-${seq.toString(16).padStart(12, "0")}`;
}

/** Create a Conversation with one Comment, returning its id. */
async function seed(
  options: {
    body?: string;
    visibility?: "public" | "private";
    timestamp?: string;
  } = {},
): Promise<string> {
  const conversationId = id();
  const timestamp = options.timestamp ?? "2026-01-15T12:00:00.000Z";
  await store.createConversation({
    header: {
      id: conversationId,
      page: "readme.md",
      anchor: null,
      author: "alice",
      timestamp,
    },
    firstComment: {
      id: id(),
      type: "comment",
      timestamp,
      author: "alice",
      body: options.body ?? "first",
    },
    ...(options.visibility ? { visibility: options.visibility } : {}),
  });
  return conversationId;
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "scholia-tracking-test-"));
  store = new SidecarStore(rootDir);
  await initRepo();
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("the default: zero footprint", () => {
  test("a repository with Conversations still has a clean git status", async () => {
    await seed();
    await seed({ visibility: "private", body: "just between us" });

    expect(await git(rootDir, "status", "--porcelain")).toBe("");
  });

  test("the root .gitignore is never written to", async () => {
    await seed();

    // The file Scholia does not own, and the one that conflicts on merge.
    expect(await exists(join(rootDir, ".gitignore"))).toBe(false);
    expect(await git(rootDir, "diff", "--name-only")).toBe("");
  });

  test("the Sidecar reports itself untracked", async () => {
    await seed();
    expect(await isCommitted(rootDir)).toBe(false);
  });
});

describe("commitSidecar", () => {
  test("drops the Sidecar's ignore file and writes the merge attributes", async () => {
    await seed();
    await commitSidecar(rootDir);

    expect(await exists(join(rootDir, ".scholia", ".gitignore"))).toBe(false);
    const attributes = await readFile(join(rootDir, ".scholia", ".gitattributes"), "utf8");
    expect(attributes).toContain("conversations/*.yaml merge=union");
    expect(await isCommitted(rootDir)).toBe(true);
  });

  test("stages the Conversations, so one commit is all that's left to do", async () => {
    const conversationId = await seed();
    const result = await commitSidecar(rootDir);

    expect(result.staged).toContain(`.scholia/conversations/${conversationId}.yaml`);
    expect(result.staged).toContain(".scholia/.gitattributes");

    const cached = await git(rootDir, "diff", "--cached", "--name-only");
    expect(cached).toContain(`.scholia/conversations/${conversationId}.yaml`);
  });

  test("works in a repository that has no Conversations yet", async () => {
    const result = await commitSidecar(rootDir);

    expect(result.staged).toEqual([".scholia/.gitattributes"]);
    expect(await isCommitted(rootDir)).toBe(true);

    // And a Conversation written afterwards is visible to git, rather than
    // hidden again by an ignore file the Sidecar wrote back.
    const conversationId = await seed();
    expect(await git(rootDir, "status", "--porcelain", "-uall")).toContain(
      `.scholia/conversations/${conversationId}.yaml`,
    );
  });

  test("running it twice changes nothing and does not fail", async () => {
    await seed();
    await commitSidecar(rootDir);
    const second = await commitSidecar(rootDir);

    expect(second.alreadyCommitted).toBe(true);
    expect(await isCommitted(rootDir)).toBe(true);
  });

  test("refuses outside a git repository, before touching anything", async () => {
    const loose = await mkdtemp(join(tmpdir(), "scholia-tracking-nogit-"));
    try {
      const looseStore = new SidecarStore(loose);
      await looseStore.createConversation({
        header: {
          id: id(),
          page: "readme.md",
          anchor: null,
          author: "alice",
          timestamp: "2026-01-15T12:00:00.000Z",
        },
        firstComment: {
          id: id(),
          type: "comment",
          timestamp: "2026-01-15T12:00:00.000Z",
          author: "alice",
          body: "first",
        },
      });

      await expect(commitSidecar(loose)).rejects.toThrow(/not (inside )?a git repository/i);
      // Nothing was written on the way to failing.
      expect(await exists(join(loose, ".scholia", ".gitignore"))).toBe(true);
      expect(await exists(join(loose, ".scholia", ".gitattributes"))).toBe(false);
    } finally {
      await rm(loose, { recursive: true, force: true });
    }
  });

  test("says so when a .gitignore Scholia does not own still hides the Sidecar", async () => {
    await seed();
    // The state a lot of repositories are already in: someone added the
    // directory to the root .gitignore by hand.
    await writeFile(join(rootDir, ".gitignore"), ".scholia/\n");

    await expect(commitSidecar(rootDir)).rejects.toThrow(/\.gitignore/);
    // And the Sidecar is left as it was, not half opted in.
    expect(await exists(join(rootDir, ".scholia", ".gitignore"))).toBe(true);
    expect(await exists(join(rootDir, ".scholia", ".gitattributes"))).toBe(false);
  });
});

describe("Chats are never committed", () => {
  test("opting in stages Threads and leaves Chats behind", async () => {
    const threadId = await seed({ body: "public" });
    const chatId = await seed({ visibility: "private", body: "private" });

    const result = await commitSidecar(rootDir);

    expect(result.staged).toContain(`.scholia/conversations/${threadId}.yaml`);
    expect(result.staged.some((p) => p.includes("chats"))).toBe(false);

    const cached = await git(rootDir, "diff", "--cached", "--name-only");
    expect(cached).not.toContain(chatId);
  });

  test("`git add -A` cannot sweep a Chat up either, opted in or not", async () => {
    const chatId = await seed({ visibility: "private", body: "private" });
    await commitSidecar(rootDir);

    await git(rootDir, "add", "-A");
    const cached = await git(rootDir, "diff", "--cached", "--name-only");
    expect(cached).not.toContain(chatId);
    expect(cached).not.toContain("chats");
  });
});

describe("uncommitSidecar", () => {
  test("puts the ignore file back and untracks the Sidecar, keeping the files", async () => {
    const conversationId = await seed();
    await commitSidecar(rootDir);
    await git(rootDir, "commit", "-m", "commit the Sidecar");

    await uncommitSidecar(rootDir);
    await git(rootDir, "commit", "-m", "untrack the Sidecar");

    // Invisible to git again...
    expect(await git(rootDir, "status", "--porcelain")).toBe("");
    expect(await isCommitted(rootDir)).toBe(false);
    expect(await exists(join(rootDir, ".scholia", ".gitattributes"))).toBe(false);

    // ...but the Conversations themselves are still there to read.
    const conversation = await store.getConversation(conversationId);
    expect(conversation!.comments[0]!.body).toBe("first");
  });

  test("is harmless on a repository that never opted in", async () => {
    await seed();
    await uncommitSidecar(rootDir);

    expect(await isCommitted(rootDir)).toBe(false);
    expect(await git(rootDir, "status", "--porcelain")).toBe("");
  });
});

describe("surviving merges", () => {
  /** Opt in and commit, so both branches below start from a tracked Sidecar. */
  async function optInAndCommit(): Promise<void> {
    await commitSidecar(rootDir);
    await git(rootDir, "commit", "-m", "commit the Sidecar");
  }

  async function commitAll(message: string): Promise<void> {
    await git(rootDir, "add", "-A");
    await git(rootDir, "commit", "-m", message);
  }

  test("two branches each adding Conversations merge with no conflict", async () => {
    await optInAndCommit();

    await git(rootDir, "checkout", "-b", "alice");
    const alicesId = await seed({ body: "alice's point" });
    await commitAll("alice comments");

    await git(rootDir, "checkout", "main");
    await git(rootDir, "checkout", "-b", "bob");
    const bobsId = await seed({ body: "bob's point" });
    await commitAll("bob comments");

    await git(rootDir, "checkout", "main");
    await git(rootDir, "merge", "--no-edit", "alice");
    await git(rootDir, "merge", "--no-edit", "bob");

    // Different Conversations are different files, so there was nothing to
    // resolve — and both survived.
    expect(await git(rootDir, "status", "--porcelain")).toBe("");
    const bodies = (await store.listConversations("readme.md")).map((c) => c.comments[0]!.body);
    expect(bodies).toContain("alice's point");
    expect(bodies).toContain("bob's point");
    expect((await store.getConversation(alicesId))!.comments).toHaveLength(1);
    expect((await store.getConversation(bobsId))!.comments).toHaveLength(1);
  });

  test("two branches replying to the same Conversation keep both replies, in order", async () => {
    const conversationId = await seed({
      body: "the question",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
    await optInAndCommit();

    // Alice replies late...
    await git(rootDir, "checkout", "-b", "alice");
    await store.appendEvent(conversationId, {
      id: id(),
      type: "comment",
      timestamp: "2026-01-15T12:20:00.000Z",
      author: "alice",
      body: "alice's reply",
    });
    await commitAll("alice replies");

    // ...and Bob, on his own branch, replies earlier.
    await git(rootDir, "checkout", "main");
    await git(rootDir, "checkout", "-b", "bob");
    await store.appendEvent(conversationId, {
      id: id(),
      type: "comment",
      timestamp: "2026-01-15T12:10:00.000Z",
      author: "bob",
      body: "bob's reply",
    });
    await commitAll("bob replies");

    await git(rootDir, "checkout", "main");
    await git(rootDir, "merge", "--no-edit", "alice");
    // Both sides appended to the end of one file. Without merge=union this is
    // the conflict that makes people delete the store.
    await git(rootDir, "merge", "--no-edit", "bob");

    expect(await git(rootDir, "status", "--porcelain")).toBe("");
    const raw = await readFile(
      join(rootDir, ".scholia", "conversations", `${conversationId}.yaml`),
      "utf8",
    );
    expect(raw).not.toContain("<<<<<<<");

    // Both replies kept, and ordered by their timestamps rather than by which
    // side of the merge they came from.
    const conversation = await store.getConversation(conversationId);
    expect(conversation!.comments.map((c) => c.body)).toEqual([
      "the question",
      "bob's reply",
      "alice's reply",
    ]);
  });

  // The case that breaks a bare `---` separator. Two `resolved` events are
  // identical but for their ids, so both sides' appended blocks share every
  // trailing line — and git trims the lines two sides have in common before
  // union keeps the rest, splicing the two documents into one and losing an
  // event. Nothing about the fold can recover from that; it has to be the
  // format (see `wrapDocument` in store.ts).
  test("two events identical but for their ids both survive the merge", async () => {
    const conversationId = await seed({ body: "the question" });
    await optInAndCommit();

    const alicesEvent = id();
    await git(rootDir, "checkout", "-b", "alice");
    await store.appendEvent(conversationId, {
      id: alicesEvent,
      type: "resolved",
      timestamp: "2026-01-15T12:10:00.000Z",
      author: "alice",
    });
    await commitAll("alice resolves");

    const bobsEvent = id();
    await git(rootDir, "checkout", "main");
    await git(rootDir, "checkout", "-b", "bob");
    await store.appendEvent(conversationId, {
      id: bobsEvent,
      type: "resolved",
      timestamp: "2026-01-15T12:10:00.000Z",
      author: "alice",
    });
    await commitAll("and so does bob's clone");

    await git(rootDir, "checkout", "main");
    await git(rootDir, "merge", "--no-edit", "alice");
    await git(rootDir, "merge", "--no-edit", "bob");

    const raw = await readFile(
      join(rootDir, ".scholia", "conversations", `${conversationId}.yaml`),
      "utf8",
    );
    // Both documents whole: each still has its own opening and closing marker.
    for (const event of [alicesEvent, bobsEvent]) {
      expect(raw).toContain(`--- # ${event}\n`);
      expect(raw).toContain(`... # ${event}\n`);
      expect(raw).toContain(`id: ${event}\n`);
    }
    expect((await store.getConversation(conversationId))!.resolved).toBe(true);
  });

  // The duplication ADR-0019 warns about, built the way a real workflow reaches
  // it. Cherry-picking an event a branch already has does nothing at all — git
  // recognises the block and drops it — so that alone proves nothing. What does
  // duplicate is two branches that acquired the *same two* events in opposite
  // orders, each having cherry-picked the other's work before merging: git can
  // align one of the two blocks as common but not both, and union emits the
  // other twice. Only the fold's dedupe by event id saves the Conversation from
  // showing a Comment twice.
  test("an event delivered twice by a cherry-pick does not become a duplicate Comment", async () => {
    const conversationId = await seed({ body: "the question" });
    await optInAndCommit();

    const alicesEvent = id();
    const bobsEvent = id();
    const reply = (eventId: string, author: string, timestamp: string, body: string) =>
      store.appendEvent(conversationId, {
        id: eventId,
        type: "comment",
        timestamp,
        author,
        body,
      });

    // Alice has her own reply, then picks up Bob's.
    await git(rootDir, "checkout", "-b", "alice");
    await reply(alicesEvent, "alice", "2026-01-15T12:10:00.000Z", "alice's reply");
    await reply(bobsEvent, "bob", "2026-01-15T12:20:00.000Z", "bob's reply");
    await commitAll("alice replies, then cherry-picks bob's");

    // Bob has the same two events, in the order he came by them.
    await git(rootDir, "checkout", "main");
    await git(rootDir, "checkout", "-b", "bob");
    await reply(bobsEvent, "bob", "2026-01-15T12:20:00.000Z", "bob's reply");
    await reply(alicesEvent, "alice", "2026-01-15T12:10:00.000Z", "alice's reply");
    await commitAll("bob replies, then cherry-picks alice's");

    await git(rootDir, "checkout", "main");
    await git(rootDir, "merge", "--no-edit", "alice");
    await git(rootDir, "merge", "--no-edit", "bob");
    expect(await git(rootDir, "status", "--porcelain")).toBe("");

    // The duplication really happened — otherwise this test would pass with the
    // dedupe taken out, which is the trap it exists to avoid.
    const raw = await readFile(
      join(rootDir, ".scholia", "conversations", `${conversationId}.yaml`),
      "utf8",
    );
    const opens = raw.match(/^--- # /gm)!.length;
    expect(opens).toBeGreaterThan(3); // header + two events is the un-duplicated count

    // And the reader sees each Comment once, in timestamp order.
    const conversation = await store.getConversation(conversationId);
    expect(conversation!.comments.map((c) => c.body)).toEqual([
      "the question",
      "alice's reply",
      "bob's reply",
    ]);
  });
});
