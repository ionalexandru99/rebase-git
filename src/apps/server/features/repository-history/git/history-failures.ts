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

export async function findHistoryRepository(
  access: RepositoryAccess,
  repositoryId: string,
) {
  try {
    return await access.repository(repositoryId);
  } catch (error) {
    throw isRepositoryRejected(error)
      ? ({
          _tag: "RepositoryMissing",
          repositoryId,
        } satisfies RepositoryHistoryFailure)
      : error;
  }
}

export function parseHistoryOutput<T>(parse: () => T) {
  try {
    return parse();
  } catch (cause) {
    throw historyFailed(
      cause instanceof Error ? cause.message : "Invalid Git history output",
    );
  }
}

function isRepositoryRejected(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "RepositoryRejected"
  );
}
