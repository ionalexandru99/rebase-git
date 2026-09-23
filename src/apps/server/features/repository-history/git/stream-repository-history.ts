import type { RepositoryCommit } from "@rebase/contracts";
import { Effect, Stream } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { GitObjectFormat } from "#server/domain/git-object-id";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import type { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import {
  parseHistoryOutput,
  snapshotInvalidated,
} from "#server/features/repository-history/git/history-failures";
import { historyTraversalPageSize } from "#server/features/repository-history/git/history-snapshot-identity";
import {
  createGitHistoryBatchParser,
  gitHistoryFormat,
} from "#server/features/repository-history/git/parse-git-history";
import { packedGitArguments } from "#server/features/repository-history/git/read-selected-history";
import { restoreShallowCommitParents } from "#server/features/repository-history/git/shallow-repository-history";
import {
  isGitRejection,
  streamRepositoryGit,
} from "#server/repository/access/index";

const batchSize = 256;
const maximumBatchCharacters = 4 * 1_048_576;
const traversalTimeoutMilliseconds = 30 * 60_000;

interface HistoryTraversal {
  readonly roots: readonly string[];
  readonly excludedRoots: readonly string[];
  readonly skip: number;
  readonly objectFormat: GitObjectFormat;
  readonly shallowOids: readonly string[];
  readonly invalidBasisOnFailure: boolean;
}

export function streamRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  traversal: HistoryTraversal,
  emit: (
    commits: readonly RepositoryCommit[],
  ) => Effect.Effect<void, RepositoryHistoryError>,
) {
  return Effect.gen(function* () {
    const frontier = new Set(traversal.roots);
    const shallow = new Set(traversal.shallowOids);
    let remainingSkip = traversal.skip;
    let emitted = 0;
    const deadline = Date.now() + traversalTimeoutMilliseconds;
    const acceptBatch = (parsed: readonly RepositoryCommit[]) =>
      Effect.gen(function* () {
        for (const commit of parsed) {
          frontier.delete(commit.oid);
          for (const parent of commit.parents) frontier.add(parent);
        }
        const skipped = Math.min(remainingSkip, parsed.length);
        remainingSkip -= skipped;
        const pending = skipped === 0 ? parsed : parsed.slice(skipped);
        if (pending.length === 0) return;
        yield* emit(
          yield* restoreShallowCommitParents(
            git,
            repositoryPath,
            pending,
            shallow,
          ),
        );
        emitted += pending.length;
      });
    while (frontier.size > 0) {
      const parsed = yield* historyPage(
        git,
        repositoryPath,
        traversal,
        frontier,
        deadline,
      ).pipe(
        Stream.runFoldEffect(
          () => 0,
          (count, batch) =>
            acceptBatch(batch).pipe(Effect.as(count + batch.length)),
        ),
      );
      if (parsed < historyTraversalPageSize) break;
    }
    if (remainingSkip > 0) return yield* snapshotInvalidated();
    return emitted;
  });
}

function historyPage(
  git: GitCommandRunner,
  repositoryPath: string,
  traversal: HistoryTraversal,
  frontier: ReadonlySet<string>,
  deadline: number,
): Stream.Stream<
  readonly RepositoryCommit[],
  RepositoryHistoryError | RepositoryGitError
> {
  return Stream.suspend(() => {
    const parser = createGitHistoryBatchParser(
      traversal.objectFormat,
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
        `--max-count=${historyTraversalPageSize}`,
        `--format=${gitHistoryFormat}`,
        "-z",
        "--",
      ],
      {
        globalArguments: packedGitArguments,
        input: `${[...frontier].sort().join("\n")}\n${traversal.excludedRoots.map((oid) => `^${oid}`).join("\n")}\n`,
        timeoutMilliseconds: Math.max(1, deadline - Date.now()),
      },
    ).pipe(
      Stream.mapError((error) =>
        traversal.invalidBasisOnFailure && isGitRejection(error)
          ? snapshotInvalidated()
          : error,
      ),
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
