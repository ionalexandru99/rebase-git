import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createRepositoryAccess } from "#server/repository/repository-access.ts";
import { catalogEntry } from "#tests-support/fixtures.ts";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const repositoryPath = "/missing/rebase/repository";
const commonDirectory = `${repositoryPath}/.git`;

describe("repository access", () => {
  it("accepts the repository and its linked worktrees", async () => {
    const access = fakeAccess({
      [repositoryPath]: [repositoryPath, commonDirectory],
      "/missing/rebase/linked": ["/missing/rebase/linked", commonDirectory],
    });

    await Effect.runPromise(
      Effect.all([
        access.requireWorktree({ repositoryId, worktreePath: repositoryPath }),
        access.requireWorktree({
          repositoryId,
          worktreePath: "/missing/rebase/linked",
        }),
      ]),
    );
  });

  it.each([
    [
      "another repository",
      "/missing/other",
      ["/missing/other", "/missing/other/.git"],
    ],
    [
      "a folder inside the repository",
      `${repositoryPath}/src`,
      [repositoryPath, commonDirectory],
    ],
    ["a folder outside Git", "/missing/plain", undefined],
  ])("rejects %s", async (_case, worktreePath, location) => {
    const access = fakeAccess({
      [repositoryPath]: [repositoryPath, commonDirectory],
      ...(location === undefined ? {} : { [worktreePath]: location }),
    });

    const failure = await Effect.runPromise(
      Effect.flip(access.requireWorktree({ repositoryId, worktreePath })),
    );

    expect(failure).toMatchObject({
      _tag: "RepositoryRejected",
      reason: "Missing",
    });
  });
});

function fakeAccess(locations: Record<string, readonly string[]>) {
  const git: GitCommandRunner = {
    stream: () => Stream.empty,
    run: (command) =>
      Effect.sync(() => {
        const location = locations[command.directory];
        return location === undefined
          ? { exitCode: 128, stderr: "not a git repository", stdout: "" }
          : { exitCode: 0, stderr: "", stdout: `${location.join("\n")}\n` };
      }),
  };
  return createRepositoryAccess(
    {
      find: (id) => Effect.succeed(catalogEntry({ id, path: repositoryPath })),
    },
    git,
  );
}
