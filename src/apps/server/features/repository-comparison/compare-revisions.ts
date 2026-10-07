import { Effect } from "effect";
import { changesFailed } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  CompareApi,
  type CompareRevisions,
  type Comparison,
  type ComparisonCommit,
  type ComparisonSide,
  maximumComparisonCommits,
} from "#contracts/repository-comparison/compare-revisions.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  fitFiles,
  readChangeDiff,
  readCommitFiles,
} from "#server/features/commit-inspection/commit-inspection.ts";

const originalObjects = { globalArguments: ["--no-replace-objects"] };
const fieldSeparator = "\x1f";

export function comparisonFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { query } = repositoryRoutes(dependencies);
  return {
    routes: [
      query(CompareApi.compare, (input, git) => compareRevisions(git, input)),
      query(CompareApi.diff, (input, git) =>
        readChangeDiff(git, input, input.parentOid ?? null),
      ),
    ],
  };
}

export function compareRevisions(
  git: GitCommandRunner,
  { repositoryId, worktreePath, from, to }: CompareRevisions,
) {
  return Effect.gen(function* () {
    const [fromOid, toOid] = yield* Effect.all(
      [resolve(git, worktreePath, from), resolve(git, worktreePath, to)],
      { concurrency: 2 },
    );
    const base = yield* mergeBase(git, worktreePath, fromOid, toOid);
    const [files, commits] = yield* Effect.all(
      [
        readCommitFiles(git, { repositoryId, worktreePath, oid: toOid }, base),
        readCommits(git, worktreePath, fromOid, toOid),
      ],
      { concurrency: 2 },
    );
    return {
      from: fromOid,
      to: toOid,
      base,
      ...fitFiles(files, Buffer.byteLength(JSON.stringify(commits))),
      commits: commits.slice(0, maximumComparisonCommits),
      commitsComplete: commits.length <= maximumComparisonCommits,
    } satisfies Comparison;
  });
}

function resolve(
  git: GitCommandRunner,
  worktreePath: string,
  side: ComparisonSide,
) {
  return runRepositoryGit(
    git,
    worktreePath,
    [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${revision(side)}^{commit}`,
    ],
    { ...originalObjects, exitCodes: [0, 1] },
  ).pipe(
    Effect.flatMap((output) => {
      const oid = output.trim();
      return oid === ""
        ? Effect.fail(changesFailed("Stale", `${sideName(side)} is gone.`))
        : Effect.succeed(oid);
    }),
  );
}

function revision(side: ComparisonSide) {
  switch (side._tag) {
    case "LocalBranch":
      return `refs/heads/${side.name}`;
    case "RemoteBranch":
      return `refs/remotes/${side.remote}/${side.name}`;
    case "Tag":
      return `refs/tags/${side.name}`;
    case "Commit":
      return side.oid;
  }
}

function sideName(side: ComparisonSide) {
  switch (side._tag) {
    case "RemoteBranch":
      return `${side.remote}/${side.name}`;
    case "Commit":
      return side.oid.slice(0, 8);
    default:
      return side.name;
  }
}

function mergeBase(
  git: GitCommandRunner,
  worktreePath: string,
  from: string,
  to: string,
) {
  return runRepositoryGit(git, worktreePath, ["merge-base", from, to], {
    ...originalObjects,
    exitCodes: [0, 1],
  }).pipe(Effect.map((output) => output.trim() || null));
}

function readCommits(
  git: GitCommandRunner,
  worktreePath: string,
  from: string,
  to: string,
) {
  return runRepositoryGit(
    git,
    worktreePath,
    [
      "log",
      "-z",
      "--no-show-signature",
      "--format=%H%x1f%P%x1f%s",
      `--max-count=${maximumComparisonCommits + 1}`,
      to,
      `^${from}`,
      "--",
    ],
    originalObjects,
  ).pipe(Effect.map(parseCommits));
}

function parseCommits(output: string): ComparisonCommit[] {
  return output.split("\0").flatMap((record) => {
    const [oid, parents, subject] = record.trim().split(fieldSeparator);
    if (oid === undefined || parents === undefined || subject === undefined)
      return [];
    return [
      {
        oid,
        parentOid: parents.split(" ").find(Boolean) ?? null,
        subject: subject.slice(0, 1_024),
      },
    ];
  });
}
