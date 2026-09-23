import { Effect } from "effect";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";

const maximumDetailLength = 2_048;

export function historyGitFailed(error: RepositoryGitError) {
  return new RepositoryHistoryError({
    cause: error,
    failure:
      error.reason === "Failed"
        ? { _tag: "GitFailed", detail: error.detail, reason: "Failed" }
        : { _tag: "GitFailed", reason: error.reason },
  });
}

export function historyFailed(detail: string, cause?: unknown) {
  return new RepositoryHistoryError({
    ...(cause === undefined ? {} : { cause }),
    failure: {
      _tag: "GitFailed",
      detail: detail.slice(0, maximumDetailLength),
      reason: "Failed",
    },
  });
}

export function historyOutputTooLarge() {
  return new RepositoryHistoryError({
    failure: { _tag: "GitFailed", reason: "OutputTooLarge" },
  });
}

export function snapshotInvalidated() {
  return new RepositoryHistoryError({
    failure: { _tag: "SnapshotInvalidated" },
  });
}

export function parseHistoryOutput<T>(parse: () => T) {
  return Effect.try({
    try: parse,
    catch: (cause) =>
      historyFailed(
        cause instanceof Error ? cause.message : "Invalid Git history output",
        cause,
      ),
  });
}
