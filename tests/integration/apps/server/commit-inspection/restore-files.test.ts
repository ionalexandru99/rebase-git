import { lstat, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { createRepository, fastImport, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

const spaced = "notes é with spaces.txt";

function file(mode: string, path: string, content: string) {
  return `M ${mode} inline ${path}\ndata ${Buffer.byteLength(content)}\n${content}\n`;
}

function commit(message: string, time: number, changes: readonly string[]) {
  return `commit refs/heads/main\ncommitter Rebase test <rebase@example.test> ${time} +0000\ndata ${message.length}\n${message}\n${changes.join("")}\n`;
}

async function fixture() {
  const environment = await openTestEnvironment();
  const directory = join(environment.home, "repository");
  await createRepository(directory, { commits: [] });
  await fastImport(
    directory,
    commit("Base", 1_700_000_000, [
      file("100644", "keep.txt", "keep\n"),
      file("100644", "gone.txt", "gone\n"),
      file("100644", spaced, "old\n"),
      file("100644", "binary.bin", "\u0000\u0001\u0002"),
      file("120000", "link", "keep.txt"),
    ]) +
      commit("Change", 1_700_000_100, [
        "D gone.txt\n",
        file("100644", spaced, "new\n"),
        file("100644", "added.txt", "added\n"),
        file("100644", "binary.bin", "\u0003\u0004"),
        file("120000", "link", "added.txt"),
      ]),
  );
  await git(directory, "reset", "--hard", "--quiet");
  const head = await git(directory, "rev-parse", "HEAD");
  const repository = await environment.remember(directory);
  return {
    directory,
    head,
    service: environment.routes(CommitInspectionApi),
    scope: { repositoryId: repository.id, worktreePath: directory, oid: head },
    read: (path: string) => readFile(join(directory, path), "utf8"),
  };
}

describe("restoring files from a commit", () => {
  it("writes the selected files from before the commit into the working tree only", async () => {
    const f = await fixture();
    expect(
      await Effect.runPromise(
        f.service.previewRestore({
          ...f.scope,
          source: "parent",
          path: "gone.txt",
        }),
      ),
    ).toMatchObject({ kind: "text", before: null, after: "gone\n" });

    await Effect.runPromise(
      f.service.restore({
        ...f.scope,
        source: "parent",
        paths: ["gone.txt", spaced, "added.txt", "binary.bin", "link"],
      }),
    );

    expect(await f.read("gone.txt")).toBe("gone\n");
    expect(await f.read(spaced)).toBe("old\n");
    expect(await f.read("keep.txt")).toBe("keep\n");
    await expect(lstat(join(f.directory, "added.txt"))).rejects.toThrow();
    expect([...(await readFile(join(f.directory, "binary.bin")))]).toEqual([
      0, 1, 2,
    ]);
    if (process.platform !== "win32")
      expect(await readlink(join(f.directory, "link"))).toBe("keep.txt");
    expect(await git(f.directory, "rev-parse", "HEAD")).toBe(f.head);
    expect(await git(f.directory, "diff", "--cached", "--name-only")).toBe("");
    const root = await Effect.runPromise(
      Effect.flip(
        f.service.restore({
          ...f.scope,
          oid: await git(f.directory, "rev-parse", "HEAD~1"),
          source: "parent",
          paths: ["keep.txt"],
        }),
      ),
    );
    expect(root).toMatchObject({
      _tag: "ChangesFailed",
      reason: "Unsupported",
    });
  });

  it("asks before replacing uncommitted edits and asks again when they change", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "keep.txt"), "staged\n");
    await git(f.directory, "add", "keep.txt");
    await writeFile(join(f.directory, spaced), "mine\n");
    const base = await git(f.directory, "rev-parse", "HEAD~1");
    const restore = (overwrite?: string) =>
      f.service.restore({
        ...f.scope,
        oid: base,
        source: "commit",
        paths: [spaced, "keep.txt"],
        ...(overwrite === undefined ? {} : { overwrite }),
      });

    const first = await Effect.runPromise(Effect.flip(restore()));
    expect(first).toMatchObject({
      _tag: "RestoreOverwrites",
      paths: [spaced],
      count: 1,
    });
    expect(await f.read(spaced)).toBe("mine\n");
    await writeFile(join(f.directory, spaced), "mine, edited again\n");
    const second = await Effect.runPromise(
      Effect.flip(
        restore(first._tag === "RestoreOverwrites" ? first.fingerprint : ""),
      ),
    );
    expect(second).toMatchObject({ _tag: "RestoreOverwrites", count: 1 });
    expect(second).not.toEqual(first);

    await Effect.runPromise(
      restore(second._tag === "RestoreOverwrites" ? second.fingerprint : ""),
    );

    expect(await f.read(spaced)).toBe("old\n");
    expect(await f.read("keep.txt")).toBe("keep\n");
    expect(await git(f.directory, "show", ":keep.txt")).toBe("staged");
  });
});
