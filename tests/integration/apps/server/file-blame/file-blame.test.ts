import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { FileBlameApi } from "#contracts/file-blame/file-blame.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

describe("file blame", () => {
  it("maps working lines to the commits that last changed them and their lines there", async () => {
    const path = await temporaryRepository();
    const file = join(path, "notes ü.txt");
    await writeFile(file, "one\ntwo\nthree\n");
    await commitAll(path, "Add notes");
    await writeFile(file, "zero\none\n  two\nthree\n");
    await commitAll(path, "Prepend zero");
    await writeFile(file, "zero\none\n  two\nthree!\n");
    await writeFile(join(path, "image.bin"), Buffer.from([0, 1, 2, 10, 0]));
    await commitAll(path, "Add image");
    await writeFile(file, "zero\none\n  two\nthree?\n");
    const [added, prepended] = (
      await git(path, "rev-parse", "HEAD~2", "HEAD~1")
    ).split("\n");
    const blame = await blameClient(path);

    const working = await blame.read("notes ü.txt", null);
    const before = await blame.read("notes ü.txt", added ?? null);
    const binary = await blame.read("image.bin", null);

    expect(working).toMatchObject({
      _tag: "Blamed",
      text: "zero\none\n  two\nthree?",
      ranges: [
        { start: 1, count: 1, oid: prepended, originalLine: 1 },
        { start: 2, count: 2, oid: added, originalLine: 1 },
        { start: 4, count: 1, oid: null, originalLine: 4 },
      ],
    });
    expect(
      working._tag === "Blamed" &&
        working.commits.find((commit) => commit.oid === prepended),
    ).toMatchObject({
      subject: "Prepend zero",
      path: "notes ü.txt",
      previous: { oid: added, path: "notes ü.txt" },
    });
    expect(before).toMatchObject({
      _tag: "Blamed",
      text: "one\ntwo\nthree",
      ranges: [{ start: 1, count: 3, oid: added, originalLine: 1 }],
      commits: [{ oid: added, previous: null }],
    });
    expect(binary).toEqual({ _tag: "Unblamable", reason: "binary" });
  });
});

async function commitAll(path: string, message: string) {
  await git(path, "add", "-A");
  await git(path, "commit", "-m", message);
}

async function blameClient(path: string) {
  const environment = await openTestEnvironment();
  const repositoryId = (await environment.remember(path)).id;
  const routes = environment.routes(FileBlameApi);
  return {
    read: (file: string, revision: string | null) =>
      Effect.runPromise(
        routes.read({ repositoryId, worktreePath: path, path: file, revision }),
      ),
  };
}

async function temporaryRepository() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase file blame ")),
  );
  onTestFinished(() => removeTemporaryDirectory(directory));
  const path = join(directory, "repository");
  await createRepository(path);
  return path;
}
