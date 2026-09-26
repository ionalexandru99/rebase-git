import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RepositoryConflictsHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { repositoryConflictsFeature } from "#server/features/repository-conflicts/repository-conflicts.feature";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import { repositoryFeatureClient } from "#tests-integration/apps/server/environment-connection/feature-routes-client";
import { createConflictedRebase } from "#tests-support/conflicted-repository";
import {
  createDivergedRepository,
  startConflict,
} from "#tests-support/diverged-repository";
import { git } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const directories: string[] = [];
const repositoryId = "00000000-0000-4000-8000-000000000001";
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});

async function fixture(create = createConflictedRebase) {
  const directory = await create();
  directories.push(directory);
  const runner = createLocalGitCommandRunner();
  const service = repositoryFeatureClient(
    RepositoryConflictsHttpApi,
    repositoryConflictsFeature,
    {
      access: createRepositoryAccess(
        {
          find: () =>
            Effect.succeed({
              id: repositoryId,
              path: directory,
              name: "test",
              addedAt: "",
              lastOpenedAt: "",
            }),
        },
        runner,
        createLocalRepositoryWatcher(),
      ),
      git: runner,
      coordination: createRepositoryCoordination(runner),
    },
  );
  const scope = { repositoryId, worktreePath: directory };
  const list = () => Effect.runPromise(service.list(scope));
  const file = async (path: string) => {
    const found = (await list()).files.find((entry) => entry.path === path);
    if (found === undefined) throw new Error(`${path} is not in conflict.`);
    return found;
  };
  return {
    directory,
    service,
    scope,
    list,
    file,
    document: (path: string) =>
      Effect.runPromise(service.document({ ...scope, path })),
    choose: async (path: string, choice: "current" | "incoming" | "delete") =>
      Effect.runPromise(
        service.choose({
          ...scope,
          path,
          choice,
          revision: (await file(path)).revision,
        }),
      ),
    content: (path: string) => readFile(join(directory, path), "utf8"),
    unmerged: (path: string) =>
      git(directory, "ls-files", "--unmerged", "--", path),
  };
}

describe("repository conflicts", () => {
  it("lists every conflict of a paused rebase with the sides Git recorded", async () => {
    const f = await fixture();

    const list = await f.list();

    expect(list.operation).toBe("rebase");
    expect(list.sides).toMatchObject({
      current: { ref: "main", subject: "current change" },
      incoming: { ref: "topic", subject: "incoming change" },
      base: { ref: null, subject: "base" },
    });
    expect(
      list.files.map(({ path, kind, choices, openRegions }) => ({
        path,
        kind,
        choices,
        openRegions,
      })),
    ).toEqual([
      {
        path: "added.txt",
        kind: "both-added",
        choices: ["current", "incoming", "worktree"],
        openRegions: 1,
      },
      {
        path: "image.bin",
        kind: "both-modified",
        choices: ["current", "incoming", "worktree"],
        openRegions: 0,
      },
      {
        path: "new-name.txt",
        kind: "both-modified",
        choices: ["current", "incoming", "worktree"],
        openRegions: 1,
      },
      {
        path: "removed-here.txt",
        kind: "deleted-in-current",
        choices: ["incoming", "delete", "worktree"],
        openRegions: 0,
      },
      {
        path: "removed-there.txt",
        kind: "deleted-in-incoming",
        choices: ["current", "delete", "worktree"],
        openRegions: 0,
      },
      {
        path: "two.txt",
        kind: "both-modified",
        choices: ["current", "incoming", "worktree"],
        openRegions: 2,
      },
    ]);
    expect(
      list.files.find((file) => file.path === "image.bin")?.stages,
    ).toEqual([
      expect.objectContaining({ side: "base", binary: true }),
      expect.objectContaining({ side: "current", binary: true, bytes: 14 }),
      expect.objectContaining({ side: "incoming", binary: true, bytes: 15 }),
    ]);
    expect(list.resolved).toEqual([]);
    expect(list.mergeTool).toBeNull();
  });

  it("labels a merge with the branch Git recorded and the merge base", async () => {
    const f = await fixture(async () => {
      const { directory, git } = await createDivergedRepository();
      await startConflict(git, "merge");
      return directory;
    });

    const list = await f.list();

    expect(list.operation).toBe("merge");
    expect(list.sides).toMatchObject({
      current: { ref: "main", subject: "main" },
      incoming: { ref: "topic", subject: "topic" },
      base: { ref: null, subject: "base" },
    });
  });

  it("builds a two-region document with base text, blame and token marks", async () => {
    const f = await fixture();

    const document = await f.document("two.txt");

    expect(document.content).toBe(await f.content("two.txt"));
    expect(document.file.openRegions).toBe(2);
    expect(document.regions).toMatchObject([
      {
        line: 2,
        open: true,
        current: ["B current"],
        base: ["b"],
        incoming: ["B incoming"],
        blame: {
          current: { subject: "current change" },
          incoming: { subject: "incoming change" },
        },
        marks: {
          current: [{ line: 0, start: 0, end: 9 }],
          incoming: [{ line: 0, start: 0, end: 10 }],
        },
      },
      {
        line: 13,
        open: true,
        current: ["G current"],
        base: ["g"],
        incoming: ["G incoming"],
      },
    ]);
    expect(document.regions[0]?.id).not.toBe(document.regions[1]?.id);
  });

  it("documents a file added on both sides and a file renamed on one side", async () => {
    const f = await fixture();

    const added = await f.document("added.txt");
    const renamed = await f.document("new-name.txt");

    expect(added.regions).toMatchObject([
      {
        open: true,
        current: ["added by current"],
        base: [],
        incoming: ["added by incoming"],
        marks: { current: [{ line: 0, start: 0, end: 16 }] },
      },
    ]);
    expect(renamed.regions).toMatchObject([
      {
        open: true,
        current: ["line 0 current"],
        base: ["line 0"],
        incoming: ["line 0 incoming"],
        blame: { current: { subject: "current change" }, incoming: null },
        marks: {
          current: [{ line: 0, start: 6, end: 14 }],
          incoming: [{ line: 0, start: 6, end: 15 }],
        },
      },
    ]);
  });
});
