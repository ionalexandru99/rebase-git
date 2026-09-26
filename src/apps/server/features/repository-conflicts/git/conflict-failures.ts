import { type ConflictFailure, repositoryRejected } from "@rebase/contracts";
import { Effect } from "effect";
import type {
  GitCommandOptions,
  GitCommandRunner,
} from "#server/domain/git-command.contract";

export function conflictFailed(
  reason: ConflictFailure["reason"],
  detail: string,
): ConflictFailure {
  return { _tag: "ConflictFailed", reason, detail: detail.slice(0, 2048) };
}

export function confirmChange<A, E, R>(refresh: Effect.Effect<A, E, R>) {
  return refresh.pipe(
    Effect.mapError(() =>
      conflictFailed(
        "Uncertain",
        "Git finished, but the refreshed conflicts could not be read.",
      ),
    ),
  );
}

export function runConflictGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: GitCommandOptions = {},
) {
  return git.run({ ...options, directory, arguments: args }).pipe(
    Effect.mapError(() =>
      conflictFailed(
        "Uncertain",
        "Git's result could not be confirmed. Refresh the conflicts before trying again.",
      ),
    ),
    Effect.flatMap((output) => {
      if (output.exitCode === 0) return Effect.succeed(output.stdout);
      const detail =
        output.stderr.trim() ||
        output.stdout.trim() ||
        "Git rejected the action.";
      return Effect.fail(
        /\.lock['\s:]|another git process/i.test(detail)
          ? repositoryRejected("Busy", detail)
          : conflictFailed("GitRejected", detail),
      );
    }),
  );
}
