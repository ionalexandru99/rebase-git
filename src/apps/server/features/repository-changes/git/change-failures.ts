import type { ChangesFailure } from "@rebase/contracts";
import { Effect } from "effect";
import { RepositoryChangesError } from "#server/domain/repository-changes.contract";

export function changesError(reason: ChangesFailure["reason"], detail: string) {
  return new RepositoryChangesError({
    failure: { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) },
  });
}
export function changeIo<T>(operation: () => Promise<T>) {
  return Effect.tryPromise({
    try: operation,
    catch: (error) =>
      changesError(
        "GitFailed",
        error instanceof Error
          ? error.message
          : "The filesystem operation failed.",
      ),
  });
}
