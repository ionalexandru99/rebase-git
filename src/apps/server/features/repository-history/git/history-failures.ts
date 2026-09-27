import type { RepositoryHistoryOperationFailure } from "@rebase/contracts";
import { Effect } from "effect";

const maximumDetailLength = 2_048;

export function historyFailed(
  detail: string,
): RepositoryHistoryOperationFailure {
  return {
    _tag: "GitFailed",
    detail: detail.slice(0, maximumDetailLength),
    reason: "Failed",
  };
}

export function historyOutputTooLarge(): RepositoryHistoryOperationFailure {
  return { _tag: "GitFailed", reason: "OutputTooLarge" };
}

export function snapshotInvalidated(): RepositoryHistoryOperationFailure {
  return { _tag: "SnapshotInvalidated" };
}

export function parseHistoryOutput<T>(parse: () => T) {
  return Effect.try({
    try: parse,
    catch: (cause) =>
      historyFailed(
        cause instanceof Error ? cause.message : "Invalid Git history output",
      ),
  });
}
