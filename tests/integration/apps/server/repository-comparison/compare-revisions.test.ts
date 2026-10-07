import { Effect, Exit } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import {
  CompareApi,
  type ComparisonSide,
} from "#contracts/repository-comparison/compare-revisions.contract.ts";
import { createComparisonRepository, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const main: ComparisonSide = { _tag: "LocalBranch", name: "main" };
const feature: ComparisonSide = { _tag: "LocalBranch", name: "feature" };

describe("compare revisions", () => {
  it("shows only what the right side added since the two split, either way round", async () => {
    const path = await createComparisonRepository();
    onTestFinished(() => removeTemporaryDirectory(path));
    const compare = await comparisonClient(path);

    const branch = await compare.revisions(main, feature);
    const swapped = await compare.revisions(feature, main);

    expect(branch.base).toBe(await git(path, "rev-parse", "v1"));
    expect(branch.files.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: "a.txt", status: "A" },
      { path: "shared.txt", status: "M" },
    ]);
    expect(branch.commits.map(({ subject }) => subject)).toEqual([
      "change shared",
      "add a",
    ]);
    expect(branch.commits.at(-1)?.parentOid).toBe(branch.base);
    expect(swapped.files.map(({ path }) => path)).toEqual(["main.txt"]);
    expect(swapped.commits.map(({ subject }) => subject)).toEqual([
      "main only",
    ]);
  });

  it("compares tags and commits, and narrows to a run of commits", async () => {
    const path = await createComparisonRepository();
    onTestFinished(() => removeTemporaryDirectory(path));
    const compare = await comparisonClient(path);
    const added = await git(path, "rev-parse", "feature~1");

    const narrowed = await compare.revisions(
      { _tag: "Tag", name: "v1" },
      { _tag: "Commit", oid: added },
    );
    const diff = await compare.diff(narrowed.base, narrowed.to, "a.txt");

    expect(narrowed.files.map(({ path }) => path)).toEqual(["a.txt"]);
    expect(diff).toMatchObject({ before: null, after: "a\n" });
  });

  it("fails with the side's name when a ref is gone", async () => {
    const path = await createComparisonRepository();
    onTestFinished(() => removeTemporaryDirectory(path));
    const compare = await comparisonClient(path);

    const exit = await compare.exit(main, {
      _tag: "LocalBranch",
      name: "deleted",
    });

    expect(exit).toMatchObject(
      Exit.fail({
        _tag: "ChangesFailed",
        reason: "Stale",
        detail: "deleted is gone.",
      }),
    );
  });
});

async function comparisonClient(path: string) {
  const environment = await openTestEnvironment();
  const repositoryId = (await environment.remember(path)).id;
  const routes = environment.routes(CompareApi);
  const request = (from: ComparisonSide, to: ComparisonSide) =>
    routes.compare({ repositoryId, worktreePath: path, from, to });
  return {
    revisions: (from: ComparisonSide, to: ComparisonSide) =>
      Effect.runPromise(request(from, to)),
    exit: (from: ComparisonSide, to: ComparisonSide) =>
      Effect.runPromiseExit(request(from, to)),
    diff: (base: string | null, to: string, file: string) =>
      Effect.runPromise(
        routes.diff({
          repositoryId,
          worktreePath: path,
          oid: to,
          ...(base === null ? {} : { parentOid: base }),
          path: file,
        }),
      ),
  };
}
