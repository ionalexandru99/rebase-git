import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepository, fastImport, git } from "#tests-support/git";

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

export async function createConflictedRebase() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-conflicts-")),
  );
  await createRepository(directory, { commits: [] });
  await git(directory, "config", "merge.conflictStyle", "zdiff3");
  await fastImport(
    directory,
    commit("refs/heads/main", "base", null, files(base)) +
      commit(
        "refs/heads/topic",
        "incoming change",
        ":1",
        `D removed-there.txt\n${files(incoming)}`,
      ) +
      commit(
        "refs/heads/main",
        "current change",
        ":1",
        `D removed-here.txt\nD old-name.txt\n${files(current)}`,
      ),
  );
  await git(directory, "checkout", "--force", "topic");
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
  from: string | null,
  changes: string,
) {
  return [
    `commit ${ref}\n`,
    from === null ? "mark :1\n" : "",
    "committer Rebase test <rebase@example.test> 1700000000 +0000\n",
    `data ${Buffer.byteLength(message)}\n${message}\n`,
    from === null ? "" : `from ${from}\n`,
    changes,
    "\n",
  ].join("");
}
