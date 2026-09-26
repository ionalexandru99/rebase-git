import { type ChangesFailure, repositoryRejected } from "@rebase/contracts";
import { Effect } from "effect";

export function changesError(
  reason: ChangesFailure["reason"],
  detail: string,
): ChangesFailure {
  return { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) };
}

export function changeIo<T>(operation: () => Promise<T>) {
  return Effect.tryPromise({
    try: operation,
    catch: (error) =>
      repositoryRejected(
        "GitFailed",
        error instanceof Error
          ? error.message
          : "The filesystem operation failed.",
      ),
  });
}
