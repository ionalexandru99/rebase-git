import { execFile } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createRepository } from "#tests-support/git";

const exec = promisify(execFile);

export async function createDivergedRepository() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-operation-")),
  );
  const git = (...args: string[]) =>
    exec("git", ["-C", directory, ...args], {
      env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" },
    });
  await createRepository(directory, { commits: [] });
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await git("config", "commit.gpgsign", "false");
  await git("config", "rerere.enabled", "false");
  await writeFile(join(directory, "file.txt"), "base\n");
  await git("add", ".");
  await git("commit", "-m", "base");
  await git("checkout", "-b", "topic");
  await writeFile(join(directory, "file.txt"), "topic\n");
  await git("commit", "-am", "topic");
  await git("checkout", "main");
  await writeFile(join(directory, "file.txt"), "main\n");
  await git("commit", "-am", "main");
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
