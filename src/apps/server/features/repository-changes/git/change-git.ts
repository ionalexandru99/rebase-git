import { createHash } from "node:crypto";
import type { ChangesFailure } from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Effect } from "effect";
import type {
  GitCommand,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import { RepositoryChangesError } from "#server/domain/repository-changes.contract";

export function changesError(reason: ChangesFailure["reason"], detail: string) {
  return new RepositoryChangesError({
    failure: { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) },
  });
}
export function changeGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: Partial<GitCommand> = {},
) {
  return git
    .run({ ...options, directory, arguments: ["--literal-pathspecs", ...args] })
    .pipe(
      Effect.mapError((error) =>
        changesError(
          "GitFailed",
          `Git could not complete the operation (${error.reason}).`,
        ),
      ),
      Effect.flatMap((output) =>
        output.exitCode === 0
          ? Effect.succeed(output.stdout)
          : Effect.fail(
              changesError(
                "GitFailed",
                output.stderr || "Git rejected the operation.",
              ),
            ),
      ),
    );
}
export function fingerprint(...values: readonly (string | Buffer)[]) {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
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
