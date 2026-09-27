import { Effect } from "effect";
import type { RepositoryHistoryFailure } from "#contracts/repository-history/repository-history.contract.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const maximumDetailLength = 2_048;

export function historyFailed(detail: string): RepositoryHistoryFailure {
  return {
    _tag: "GitFailed",
    detail: detail.slice(0, maximumDetailLength),
    reason: "Failed",
  };
}

export function historyWireFailure(
  failure: RepositoryHistoryFailure,
): RepositoryHistoryFailure {
  if (failure._tag !== "GitFailed") return failure;
  return failure.reason === "Failed" && failure.detail !== undefined
    ? { _tag: "GitFailed", detail: failure.detail, reason: "Failed" }
    : { _tag: "GitFailed", reason: failure.reason };
}

export function findHistoryRepository(
  access: RepositoryAccess,
  repositoryId: string,
) {
  return access
    .repository(repositoryId)
    .pipe(
      Effect.mapError(
        (error): RepositoryHistoryFailure =>
          error._tag === "RepositoryRejected"
            ? { _tag: "RepositoryMissing", repositoryId }
            : { _tag: "GitFailed", reason: "Failed" },
      ),
    );
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
