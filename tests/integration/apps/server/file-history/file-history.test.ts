import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { FileHistoryApi } from "#contracts/file-history/file-history.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const lines = (count: number, last: string) =>
  `${Array.from({ length: count }, (_, index) => `line ${index}`).join("\n")}\n${last}\n`;

describe("file history", () => {
  it("follows a rename back to the first commit and pages with a growing limit", async () => {
    const path = await temporaryRepository();
    await writeFile(join(path, "old name.txt"), lines(20, "first"));
    await commitAll(path, "add");
    await writeFile(join(path, "old name.txt"), lines(20, "second"));
    await commitAll(path, "edit");
    await mkdir(join(path, "moved"));
    await git(path, "mv", "old name.txt", "moved/new name.txt");
    await commitAll(path, "rename");
    await rm(join(path, "moved", "new name.txt"));
    await commitAll(path, "delete");
    const history = await historyClient(path);

    const all = await history.read("moved/new name.txt", 100);
    const page = await history.read("moved/new name.txt", 2);

    expect(all.complete).toBe(true);
    expect(
      all.entries.map(({ subject, status, path, previousPath, lines }) => ({
        subject,
        status,
        path,
        previousPath,
        lines,
      })),
    ).toEqual([
      {
        subject: "delete",
        status: "D",
        path: "moved/new name.txt",
        previousPath: null,
        lines: { added: 0, removed: 21 },
      },
      {
        subject: "rename",
        status: "R",
        path: "moved/new name.txt",
        previousPath: "old name.txt",
        lines: { added: 0, removed: 0 },
      },
      {
        subject: "edit",
        status: "M",
        path: "old name.txt",
        previousPath: null,
        lines: { added: 1, removed: 1 },
      },
      {
        subject: "add",
        status: "A",
        path: "old name.txt",
        previousPath: null,
        lines: { added: 21, removed: 0 },
      },
    ]);
    expect(all.entries.at(-1)?.parentOid).toBe(
      await git(path, "rev-parse", "HEAD~4"),
    );
    expect(page).toEqual({ entries: all.entries.slice(0, 2), complete: false });
  });
});

async function commitAll(path: string, message: string) {
  await git(path, "add", "-A");
  await git(path, "commit", "-m", message);
}

async function historyClient(path: string) {
  const environment = await openTestEnvironment();
  const repositoryId = (await environment.remember(path)).id;
  const routes = environment.routes(FileHistoryApi);
  return {
    read: (file: string, limit: number) =>
      Effect.runPromise(
        routes.read({ repositoryId, worktreePath: path, path: file, limit }),
      ),
  };
}

async function temporaryRepository() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase file history ")),
  );
  onTestFinished(() => removeTemporaryDirectory(directory));
  const path = join(directory, "repository");
  await createRepository(path);
  return path;
}
