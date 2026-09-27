import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";

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
