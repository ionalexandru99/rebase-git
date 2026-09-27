import { Effect, Stream } from "effect";
import type {
  RepositoryCommit,
  RepositoryHistoryFailure,
} from "#contracts/repository-history/repository-history.contract.ts";
import {
  type GitCommandRunner,
  type GitObjectFormat,
  runRepositoryGit,
  streamRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { parseHistoryOutput } from "#server/features/repository-history/git/history-failures.ts";
import {
  createGitHistoryBatchParser,
  gitHistoryFormat,
} from "#server/features/repository-history/git/parse-git-history.ts";
import { restoreShallowCommitParents } from "#server/features/repository-history/git/shallow-repository-history.ts";

const batchSize = 256;
const pageSize = 5_000;
const maximumBatchCharacters = 4 * 1_048_576;
const traversalTimeoutMilliseconds = 30 * 60_000;
const packedGitArguments = [
  "-c",
  "core.packedGitLimit=32m",
  "-c",
  "core.packedGitWindowSize=16m",
];

interface HistoryTraversal {
  readonly roots: readonly string[];
  readonly knownTips: readonly string[];
  readonly objectFormat: GitObjectFormat;
  readonly shallowOids: readonly string[];
}

export function streamRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  traversal: HistoryTraversal,
  emit: (
    commits: readonly RepositoryCommit[],
  ) => Effect.Effect<void, RepositoryHistoryFailure>,
) {
  return Effect.gen(function* () {
    const excluded = yield* existingCommits(
      git,
      repositoryPath,
      traversal.knownTips,
    );
    const frontier = new Set(traversal.roots);
    const shallow = new Set(traversal.shallowOids);
    const deadline = Date.now() + traversalTimeoutMilliseconds;
    const acceptBatch = (commits: readonly RepositoryCommit[]) =>
      Effect.gen(function* () {
        for (const commit of commits) {
          frontier.delete(commit.oid);
          for (const parent of commit.parents) frontier.add(parent);
        }
        yield* emit(
          yield* restoreShallowCommitParents(
            git,
            repositoryPath,
            commits,
            shallow,
          ),
        );
      });
    while (frontier.size > 0) {
      const parsed = yield* historyPage(
        git,
        repositoryPath,
        traversal.objectFormat,
        frontier,
        excluded,
        deadline,
      ).pipe(
        Stream.runFoldEffect(
          () => 0,
          (count, batch) =>
            acceptBatch(batch).pipe(Effect.as(count + batch.length)),
        ),
      );
      if (parsed < pageSize) break;
    }
  });
}

function existingCommits(
  git: GitCommandRunner,
  repositoryPath: string,
  oids: readonly string[],
) {
  if (oids.length === 0) return Effect.succeed([]);
  return runRepositoryGit(
    git,
    repositoryPath,
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    { input: `${oids.join("\n")}\n`, maxOutputBytes: 8 * 1_048_576 },
  ).pipe(
    Effect.map((output) =>
      output
        .split("\n")
        .flatMap((line) =>
          line.endsWith(" commit") ? [line.slice(0, line.indexOf(" "))] : [],
        ),
    ),
  );
}

function historyPage(
  git: GitCommandRunner,
  repositoryPath: string,
  objectFormat: GitObjectFormat,
  frontier: ReadonlySet<string>,
  excluded: readonly string[],
  deadline: number,
): Stream.Stream<readonly RepositoryCommit[], RepositoryHistoryFailure> {
  return Stream.suspend(() => {
    const parser = createGitHistoryBatchParser(
      objectFormat,
      batchSize,
      maximumBatchCharacters,
    );
    return streamRepositoryGit(
      git,
      repositoryPath,
      [
        "log",
        "--stdin",
        "--topo-order",
        "--no-show-signature",
        `--max-count=${pageSize}`,
        `--format=${gitHistoryFormat}`,
        "-z",
        "--",
      ],
      {
        globalArguments: packedGitArguments,
        input: `${[...frontier].sort().join("\n")}\n${excluded.map((oid) => `^${oid}`).join("\n")}\n`,
        timeoutMilliseconds: Math.max(1, deadline - Date.now()),
      },
    ).pipe(
      Stream.mapEffect((chunk) =>
        parseHistoryOutput(() => parser.accept(chunk)),
      ),
      Stream.concat(
        Stream.fromEffect(parseHistoryOutput(() => parser.finish())),
      ),
      Stream.flattenIterable,
    );
  });
}
