import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const testIdentity = [
  "-c",
  "user.name=Rebase test",
  "-c",
  "user.email=rebase@example.test",
];

export async function git(path: string, ...arguments_: string[]) {
  const { stdout } = await execute("git", [
    "-C",
    path,
    ...testIdentity,
    ...arguments_,
  ]);
  return stdout.trim();
}

export async function createRepository(
  path: string,
  {
    commits = ["initial"],
    branches = [],
  }: {
    readonly commits?: readonly string[];
    readonly branches?: readonly string[];
  } = {},
) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  await git(path, "config", "core.autocrlf", "false");
  for (const message of commits)
    await git(path, "commit", "--allow-empty", "-m", message);
  for (const branch of branches) await git(path, "branch", branch);
}

export async function cloneRepository(
  source: string,
  destination: string,
  ...arguments_: string[]
) {
  await git(
    dirname(destination),
    "clone",
    "--config",
    "core.autocrlf=false",
    ...arguments_,
    source,
    destination,
  );
}

export async function fastImport(path: string, stream: string) {
  const imported = execute("git", ["-C", path, "fast-import", "--quiet"]);
  imported.child.stdin?.end(`${stream}done\n`);
  await imported;
}

export async function createDivergedRepository(parent = tmpdir()) {
  const directory = await realpath(
    await mkdtemp(join(parent, "rebase-operation-")),
  );
  const git = (...args: string[]) =>
    execute("git", ["-C", directory, ...args], {
      env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" },
    });
  await createRepository(directory, { commits: [] });
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await git("config", "commit.gpgsign", "false");
  await git("config", "rerere.enabled", "false");
  await fastImport(
    directory,
    commit("refs/heads/main", "base", null, files({ "file.txt": "base\n" })) +
      commit(
        "refs/heads/topic",
        "topic",
        ":1",
        files({ "file.txt": "topic\n" }),
      ) +
      commit("refs/heads/main", "main", ":1", files({ "file.txt": "main\n" })),
  );
  await git("reset", "--hard");
  return { directory, git };
}

export async function createMergeRepository(parent = tmpdir()) {
  const { directory, git } = await createDivergedRepository(parent);
  await fastImport(
    directory,
    commit(
      "refs/heads/clean",
      "clean",
      "refs/heads/main^",
      files({ "new.txt": "clean\n" }),
    ) +
      commit(
        "refs/heads/ahead",
        "ahead",
        "refs/heads/main",
        files({ "ahead.txt": "ahead\n" }),
      ) +
      commit(
        "refs/heads/lonely",
        "lonely",
        null,
        files({ "lonely.txt": "lonely\n" }),
      ),
  );
  return { directory, git };
}

export function startConflict(
  git: (...args: string[]) => Promise<unknown>,
  kind: "merge" | "rebase" | "cherry-pick" | "revert",
) {
  return git(kind, kind === "revert" ? "HEAD~1" : "topic").then(
    () => {
      throw new Error(`Expected ${kind} to stop on a conflict.`);
    },
    () => undefined,
  );
}

export async function createRebaseRepository(parent = tmpdir()) {
  const directory = await realpath(await mkdtemp(join(parent, "rebase-onto-")));
  await createRepository(directory, { commits: [] });
  await git(directory, "config", "user.name", "Rebase test");
  await git(directory, "config", "user.email", "rebase@example.test");
  await git(directory, "config", "commit.gpgsign", "false");
  await fastImport(
    directory,
    commit(
      "refs/heads/main",
      "base",
      null,
      files({ "file.txt": "base\n", "shared.txt": "base\n" }),
    ) +
      commit(
        "refs/heads/topic",
        "topic one",
        ":1",
        files({ "one.txt": "one\n" }),
      ) +
      commit(
        "refs/heads/topic",
        "topic file",
        undefined,
        files({ "file.txt": "topic\n" }),
      ) +
      commit(
        "refs/heads/topic",
        "shared change",
        undefined,
        files({ "shared.txt": "changed\n" }),
      ) +
      commit("refs/heads/side", "side", ":1", files({ "side.txt": "side\n" })) +
      commit(
        "refs/heads/merged",
        "merged one",
        ":1",
        files({ "merged.txt": "merged\n" }),
      ) +
      "commit refs/heads/merged\ncommitter Rebase test <rebase@example.test> 1700000000 +0000\ndata 10\nmerge side\nmerge refs/heads/side\n\n" +
      commit(
        "refs/heads/main",
        "main file",
        ":1",
        files({ "file.txt": "main\n" }),
      ) +
      commit(
        "refs/heads/main",
        "shared change",
        undefined,
        files({ "shared.txt": "changed\n" }),
      ),
  );
  await git(directory, "checkout", "--force", "topic");
  return directory;
}

const lines = (...values: string[]) =>
  values.map((line) => `${line}\n`).join("");
const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
const renamed = Array.from({ length: 12 }, (_, index) => `line ${index}`);

const base = {
  "two.txt": lines(...letters),
  "removed-here.txt": lines("removed here"),
  "removed-there.txt": lines("removed there"),
  "image.bin": "base\0binary",
  "old-name.txt": lines(...renamed),
};

const current = {
  "two.txt": lines("a", "B current", "c", "d", "e", "f", "G current", "h"),
  "removed-there.txt": lines("kept by current"),
  "added.txt": lines("added by current"),
  "image.bin": "current\0binary",
  "new-name.txt": lines("line 0 current", ...renamed.slice(1)),
};

const incoming = {
  "two.txt": lines("a", "B incoming", "c", "d", "e", "f", "G incoming", "h"),
  "removed-here.txt": lines("kept by incoming"),
  "added.txt": lines("added by incoming"),
  "image.bin": "incoming\0binary",
  "old-name.txt": lines("line 0 incoming", ...renamed.slice(1)),
};

const textFiles = new Set(["two.txt", "added.txt"]);

export async function createConflictedRebase(
  parent = tmpdir(),
  {
    files: kept = "all",
    paused = true,
  }: { readonly files?: "all" | "text"; readonly paused?: boolean } = {},
) {
  const only = (entries: Record<string, string>) =>
    kept === "all"
      ? entries
      : Object.fromEntries(
          Object.entries(entries).filter(([path]) => textFiles.has(path)),
        );
  const deleted = (...paths: string[]) =>
    kept === "all" ? paths.map((path) => `D ${path}\n`).join("") : "";
  const directory = await realpath(
    await mkdtemp(join(parent, "rebase-conflicts-")),
  );
  await createRepository(directory, { commits: [] });
  await git(directory, "config", "merge.conflictStyle", "zdiff3");
  await fastImport(
    directory,
    commit("refs/heads/main", "base", null, files(only(base))) +
      commit(
        "refs/heads/topic",
        "incoming change",
        ":1",
        `${deleted("removed-there.txt")}${files(only(incoming))}`,
      ) +
      commit(
        "refs/heads/main",
        "current change",
        ":1",
        `${deleted("removed-here.txt", "old-name.txt")}${files(only(current))}`,
      ),
  );
  await git(directory, "checkout", "--force", "topic");
  if (!paused) return directory;
  await git(directory, "rebase", "main").then(
    () => {
      throw new Error("Expected the rebase to stop on conflicts.");
    },
    () => undefined,
  );
  return directory;
}

function files(entries: Record<string, string>) {
  return Object.entries(entries)
    .map(
      ([path, content]) =>
        `M 100644 inline ${path}\ndata ${Buffer.byteLength(content)}\n${content}\n`,
    )
    .join("");
}

function commit(
  ref: string,
  message: string,
  from: string | null | undefined,
  changes: string,
) {
  return [
    `commit ${ref}\n`,
    from === null ? "mark :1\n" : "",
    "committer Rebase test <rebase@example.test> 1700000000 +0000\n",
    `data ${Buffer.byteLength(message)}\n${message}\n`,
    from === null || from === undefined ? "" : `from ${from}\n`,
    changes,
    "\n",
  ].join("");
}
