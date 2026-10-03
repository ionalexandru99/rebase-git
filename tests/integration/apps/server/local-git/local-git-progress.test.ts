import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const runner = createLocalGitCommandRunner();
let root = "";
let local = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rebase-progress-"));
  const remote = join(root, "remote.git");
  local = join(root, "local");
  await git(root, "init", "--bare", "-b", "main", remote);
  const hook = join(remote, "hooks", "pre-receive");
  await writeFile(
    hook,
    "#!/bin/sh\necho 'name must match JIRA-123' >&2\necho 'Total 3 errors' >&2\nexit 1\n",
  );
  await chmod(hook, 0o755);
  await createRepository(local, { commits: [] });
  await writeFile(join(local, "file.txt"), "x".repeat(4_096));
  await git(local, "add", "file.txt");
  await git(local, "commit", "-m", "work");
  await git(local, "remote", "add", "origin", remote);
});

afterAll(async () => {
  await removeTemporaryDirectory(root);
});

it("reports Git's progress and keeps it out of the failure message", async () => {
  const reported: string[] = [];

  const withProgress = await Effect.runPromise(
    runner.run({
      directory: local,
      arguments: ["push", "--progress", "origin", "main"],
      progress: (output) => reported.push(output),
    }),
  );
  const plain = await Effect.runPromise(
    runner.run({ directory: local, arguments: ["push", "origin", "main"] }),
  );

  expect(reported.join("")).toContain("Writing objects: 100%");
  expect(plain.stderr).toContain("name must match JIRA-123");
  expect(plain.stderr).toContain("Total 3 errors");
  expect(withProgress.stderr).toBe(plain.stderr);
});
