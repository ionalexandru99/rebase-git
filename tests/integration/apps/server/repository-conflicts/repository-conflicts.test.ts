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

  it("saves an edit without staging it and rejects a stale revision", async () => {
    const f = await fixture();
    const loaded = await f.document("two.txt");
    const edited = loaded.content.replace(
      /<<<<<<< HEAD\nB current\n[\s\S]*?>>>>>>> [^\n]*\n/,
      "B merged\n",
    );

    const saved = await Effect.runPromise(
      f.service.write({
        ...f.scope,
        path: "two.txt",
        revision: loaded.file.revision,
        content: edited,
      }),
    );

    expect(await f.content("two.txt")).toBe(edited);
    expect(saved.file.openRegions).toBe(1);
    expect(saved.regions.map(({ open, line }) => ({ open, line }))).toEqual([
      { open: false, line: null },
      { open: true, line: 7 },
    ]);
    expect((await f.unmerged("two.txt")).split("\n")).toHaveLength(3);
    await expect(
      Effect.runPromise(
        f.service.write({
          ...f.scope,
          path: "two.txt",
          revision: loaded.file.revision,
          content: "lost\n",
        }),
      ),
    ).rejects.toMatchObject({ reason: "Stale" });
    expect(await f.content("two.txt")).toBe(edited);
  });

  it("stages a file with markers only when asked to", async () => {
    const f = await fixture();
    const stage = async (allowMarkers: boolean) =>
      Effect.runPromise(
        f.service.stage({
          ...f.scope,
          path: "two.txt",
          revision: (await f.file("two.txt")).revision,
          allowMarkers,
        }),
      );

    await expect(stage(false)).rejects.toMatchObject({
      reason: "Markers",
      detail: expect.stringContaining("2 conflict blocks"),
    });
    const list = await stage(true);

    expect(list.files.map((file) => file.path)).not.toContain("two.txt");
    expect(list.resolved).toEqual(["two.txt"]);
    expect(await f.unmerged("two.txt")).toBe("");
    await expect(f.document("two.txt")).rejects.toMatchObject({
      reason: "Missing",
    });
  });

  it("takes one side of a file and reopens the conflict", async () => {
    const f = await fixture();

    await f.choose("new-name.txt", "incoming");
    const chosen = await f.choose("two.txt", "current");

    expect(await f.content("two.txt")).toBe(
      "a\nB current\nc\nd\ne\nf\nG current\nh\n",
    );
    expect(await f.content("new-name.txt")).toMatch(/^line 0 incoming\n/);
    expect(chosen.resolved).toEqual(["new-name.txt", "two.txt"]);
    expect(await f.unmerged("two.txt")).toBe("");

    const reopened = await Effect.runPromise(
      f.service.reopen({ ...f.scope, path: "two.txt" }),
    );

    expect(reopened.resolved).toEqual(["new-name.txt"]);
    expect(
      reopened.files.find((file) => file.path === "two.txt")?.openRegions,
    ).toBe(2);
    expect((await f.unmerged("two.txt")).split("\n")).toHaveLength(3);
  });

  it("deletes or keeps a file removed on one side", async () => {
    const f = await fixture();

    await expect(f.choose("removed-here.txt", "current")).rejects.toMatchObject(
      { reason: "Unsupported" },
    );
    await f.choose("removed-here.txt", "delete");
    await f.choose("removed-there.txt", "current");

    await expect(f.content("removed-here.txt")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await git(f.directory, "ls-files", "--", "removed-here.txt")).toBe(
      "",
    );
    expect(await f.content("removed-there.txt")).toBe("kept by current\n");
    expect(await f.unmerged("removed-there.txt")).toBe("");

    await Effect.runPromise(
      f.service.reopen({ ...f.scope, path: "removed-here.txt" }),
    );

    expect(await f.file("removed-here.txt")).toMatchObject({
      kind: "deleted-in-current",
    });
    expect(await f.content("removed-here.txt")).toBe("kept by incoming\n");
  });

  it("resolves a binary conflict as a whole file only", async () => {
    const f = await fixture();

    await expect(f.document("image.bin")).rejects.toMatchObject({
      reason: "Unsupported",
    });
    await f.choose("image.bin", "incoming");

    expect(await f.content("image.bin")).toBe("incoming\0binary");
    expect(await f.unmerged("image.bin")).toBe("");
  });

  it("hands a file to the configured merge tool", async () => {
    const f = await fixture();
    const mergeTool = () =>
      Effect.runPromise(f.service.mergeTool({ ...f.scope, path: "added.txt" }));

    await expect(mergeTool()).rejects.toMatchObject({ reason: "NoMergeTool" });
    await git(f.directory, "config", "merge.tool", "copy");
    await git(
      f.directory,
      "config",
      "mergetool.copy.cmd",
      'cp "$REMOTE" "$MERGED"',
    );
    await git(f.directory, "config", "mergetool.copy.trustExitCode", "true");
    const list = await mergeTool();

    expect(list.mergeTool).toBe("copy");
    expect(list.resolved).toEqual(["added.txt"]);
    expect(await f.content("added.txt")).toBe("added by incoming\n");
  });
});
