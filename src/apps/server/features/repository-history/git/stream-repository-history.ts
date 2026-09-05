import type { RepositoryCommit } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { historyTraversalPageSize } from "#server/features/repository-history/git/history-snapshot-identity";
import {
  createGitHistoryBatchParser,
  gitHistoryFormat,
} from "#server/features/repository-history/git/parse-git-history";
import { restoreShallowCommitParents } from "#server/features/repository-history/git/shallow-repository-history";

const batchSize = 256;
const maximumBatchCharacters = 4 * 1_048_576;

export function streamRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  options: {
    readonly roots: readonly string[];
    readonly excludedRoots: readonly string[];
    readonly skip: number;
    readonly objectFormat: "sha1" | "sha256";
    readonly shallowOids: readonly string[];
    readonly invalidBasisOnFailure: boolean;
  },
  emit: (
    commits: readonly RepositoryCommit[],
  ) => Effect.Effect<void, RepositoryHistoryError>,
) {
  return Effect.gen(function* () {
    const stream = git.stream;
    if (stream === undefined)
      return yield* failed("Git history streaming is unavailable");
    const frontier = new Set(options.roots);
    const shallow = new Set(options.shallowOids);
    let remainingSkip = options.skip;
    let emitted = 0;
    const deadline = Date.now() + 30 * 60_000;
    while (frontier.size > 0) {
      let signal: AbortSignal | undefined;
      let emitFailure: RepositoryHistoryError | undefined;
      const parser = createGitHistoryBatchParser(
        options.objectFormat,
        batchSize,
        async (parsed) => {
          for (const commit of parsed) {
            frontier.delete(commit.oid);
            for (const parent of commit.parents) frontier.add(parent);
          }
          const skipped = Math.min(remainingSkip, parsed.length);
          remainingSkip -= skipped;
          const pending = skipped === 0 ? parsed : parsed.slice(skipped);
          if (pending.length === 0) return;
          await Effect.runPromise(
            restoreShallowCommitParents(
              git,
              repositoryPath,
              pending,
              shallow,
            ).pipe(
              Effect.flatMap(emit),
              Effect.tapError((failure) =>
                Effect.sync(() => {
                  emitFailure = failure;
                }),
              ),
            ),
            signal === undefined ? undefined : { signal },
          );
          emitted += pending.length;
        },
        maximumBatchCharacters,
      );
      const output = yield* stream(
        {
          arguments: [
            "-c",
            "core.packedGitLimit=32m",
            "-c",
            "core.packedGitWindowSize=16m",
            "log",
            "--stdin",
            "--topo-order",
            "--no-show-signature",
            `--max-count=${historyTraversalPageSize}`,
            `--format=${gitHistoryFormat}`,
            "-z",
            "--",
          ],
          directory: repositoryPath,
          input: `${[...frontier].sort().join("\n")}\n${options.excludedRoots.map((oid) => `^${oid}`).join("\n")}\n`,
          timeoutMilliseconds: Math.max(1, deadline - Date.now()),
        },
        (chunk, currentSignal) => {
          signal = currentSignal;
          return parser.accept(chunk);
        },
      ).pipe(Effect.mapError((cause) => emitFailure ?? historyFailure(cause)));
      if (output.exitCode !== 0)
        return yield* options.invalidBasisOnFailure
          ? Effect.fail(
              new RepositoryHistoryError({
                failure: { _tag: "SnapshotInvalidated" },
              }),
            )
          : failed(output.stderr.slice(0, 2_048));
      const count = yield* Effect.tryPromise({
        try: (currentSignal) => {
          signal = currentSignal;
          return parser.finish();
        },
        catch: (cause) => emitFailure ?? historyFailure(cause),
      });
      if (count < historyTraversalPageSize) break;
    }
    if (remainingSkip > 0)
      return yield* new RepositoryHistoryError({
        failure: { _tag: "SnapshotInvalidated" },
      });
    return emitted;
  });
}

function historyFailure(cause: unknown) {
  if (cause instanceof RepositoryHistoryError) return cause;
  const reason =
    typeof cause === "object" &&
    cause !== null &&
    "reason" in cause &&
    (cause.reason === "GitUnavailable" ||
      cause.reason === "Timeout" ||
      cause.reason === "OutputTooLarge" ||
      cause.reason === "Failed")
      ? cause.reason
      : "Failed";
  return new RepositoryHistoryError({
    cause,
    failure: { _tag: "GitFailed", reason },
  });
}

function failed(detail: string) {
  return Effect.fail(
    new RepositoryHistoryError({
      failure: { _tag: "GitFailed", detail, reason: "Failed" },
    }),
  );
}
