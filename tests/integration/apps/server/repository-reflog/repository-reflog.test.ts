import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import {
  type ReflogRef,
  RepositoryReflogApi,
  type ResetToCommit,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";
import {
  createConflictedRebase,
  createRepository,
  git,
} from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

describe("repository reflog", () => {
  it("groups an amend and a rebase and marks the replaced tips as reflog-only", async () => {
    const path = await temporaryRepository();
    await git(path, "switch", "-c", "topic");
    await git(path, "commit", "--allow-empty", "-m", "topic");
    const amended = await git(path, "rev-parse", "HEAD");
    await git(path, "commit", "--amend", "--allow-empty", "-m", "topic again");
    const beforeRebase = await git(path, "rev-parse", "HEAD");
    await git(path, "switch", "main");
    await git(path, "commit", "--allow-empty", "-m", "on main");
    await git(path, "switch", "topic");
    await git(path, "rebase", "main");
    const reflog = await reflogClient(path);

    const [rebase, ...older] = (await reflog.read({ _tag: "Head" })).entries;
    const [branchRebase] = (
      await reflog.read({ _tag: "LocalBranch", name: "topic" })
    ).entries;

    expect(rebase).toMatchObject({
      action: "rebase",
      description: "Rebased onto main",
      previousOid: beforeRebase,
      oid: await git(path, "rev-parse", "HEAD"),
    });
    expect(older.find((entry) => entry.action === "amend")).toMatchObject({
      oid: beforeRebase,
      previousOid: amended,
      orphaned: true,
    });
    expect(older).toContainEqual(
      expect.objectContaining({
        action: "switch",
        description: "main → topic",
      }),
    );
    expect(branchRebase).toMatchObject({
      action: "rebase",
      previousOid: beforeRebase,
    });
  });

  it("applies soft, mixed and hard resets with their exact effects", async () => {
    const path = await temporaryRepository();
    const first = await commitFile(path, "one\n");
    const second = await commitFile(path, "two\n");
    await writeFile(join(path, "file.txt"), "local\n");
    await git(path, "add", "file.txt");
    const reflog = await reflogClient(path);

    await reflog.reset({ target: first, mode: "soft", expectedHead: second });
    expect(await state(path)).toEqual({
      head: first,
      staged: "file.txt",
      unstaged: "",
      content: "local\n",
    });

    await reflog.reset({ target: second, mode: "mixed", expectedHead: first });
    expect(await state(path)).toEqual({
      head: second,
      staged: "",
      unstaged: "file.txt",
      content: "local\n",
    });

    const discard = await reflog
      .reset({ target: first, mode: "hard", expectedHead: second })
      .then(
        () => undefined,
        (failure: unknown) => failure,
      );
    expect(discard).toMatchObject({
      _tag: "ResetDiscardsChanges",
      paths: ["file.txt"],
      count: 1,
    });
    expect(await state(path)).toMatchObject({ head: second });

    await reflog.reset({
      target: first,
      mode: "hard",
      expectedHead: second,
      discard: (discard as { readonly fingerprint: string }).fingerprint,
    });
    expect(await state(path)).toEqual({
      head: first,
      staged: "",
      unstaged: "",
      content: "one\n",
    });
  });

  it("leaves the new files a mixed reset brings back untracked outside a rebase", async () => {
    const path = await temporaryRepository();
    const first = await commitFile(path, "one\n");
    await writeFile(join(path, "new.txt"), "new\n");
    await git(path, "add", "new.txt");
    await git(path, "commit", "-m", "new file");
    const reflog = await reflogClient(path);

    await reflog.reset({
      target: first,
      mode: "mixed",
      expectedHead: await git(path, "rev-parse", "HEAD"),
    });

    expect(await git(path, "status", "--porcelain")).toBe("?? new.txt");
  });

  it("refuses a stale head and a reset during a rebase", async () => {
    const path = await temporaryRepository();
    const first = await commitFile(path, "one\n");
    const second = await commitFile(path, "two\n");
    const reflog = await reflogClient(path);

    await expect(
      reflog.reset({ target: first, mode: "soft", expectedHead: first }),
    ).rejects.toEqual({ _tag: "HeadMoved", head: second });

    const rebasing = await createConflictedRebase(await temporaryDirectory());
    const conflicted = await reflogClient(rebasing);
    const head = await git(rebasing, "rev-parse", "HEAD");
    await expect(
      conflicted.reset({ target: head, mode: "soft", expectedHead: head }),
    ).rejects.toMatchObject({
      _tag: "RepositoryRejected",
      reason: "Incompatible",
    });
  });
});

async function reflogClient(path: string) {
  const environment = await openTestEnvironment();
  const repositoryId = (await environment.remember(path)).id;
  const routes = environment.routes(RepositoryReflogApi);
  const scope = { repositoryId, worktreePath: path };
  return {
    read: (ref: ReflogRef) => Effect.runPromise(routes.read({ ...scope, ref })),
    reset: (command: Omit<ResetToCommit, "repositoryId" | "worktreePath">) =>
      Effect.runPromise(routes.reset({ ...scope, ...command })),
  };
}

async function commitFile(path: string, content: string) {
  await writeFile(join(path, "file.txt"), content);
  await git(path, "add", "file.txt");
  await git(path, "commit", "-m", content.trim());
  return git(path, "rev-parse", "HEAD");
}

async function state(path: string) {
  return {
    head: await git(path, "rev-parse", "HEAD"),
    staged: await git(path, "diff", "--cached", "--name-only"),
    unstaged: await git(path, "diff", "--name-only"),
    content: await readFile(join(path, "file.txt"), "utf8"),
  };
}

async function temporaryRepository() {
  const path = join(await temporaryDirectory(), "repository");
  await createRepository(path);
  return path;
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase reflog "));
  onTestFinished(() => removeTemporaryDirectory(directory));
  return realpath(directory);
}
