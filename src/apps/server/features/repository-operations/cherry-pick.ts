import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import type {
  StartCherryPick,
  StartOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import {
  operationFailure,
  readCommit,
  requireGitSuccess,
  started,
  uncertain,
} from "#server/features/repository-operations/operation-outcome.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export function startCherryPick(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: StartOperation,
  { commits, mainline, result }: StartCherryPick,
) {
  return Effect.gen(function* () {
    if ((yield* readCommit(git, directory, "HEAD")) !== expectedHead)
      return yield* operationFailure("Stale", "HEAD moved. Try again.");
    const merges = (yield* readParentCounts(git, directory, commits)).filter(
      (count) => count > 1,
    );
    if (merges.length > 1)
      return yield* operationFailure(
        "Incompatible",
        "Cherry-pick one merge commit at a time.",
      );
    if (merges.length === 1 && mainline === null)
      return yield* operationFailure(
        "Incompatible",
        "Choose a parent for the merge commit.",
      );
    if (mainline !== null && merges.some((count) => mainline > count))
      return yield* operationFailure(
        "Incompatible",
        `The merge commit has no parent ${mainline}.`,
      );
    if (result === "stage" && (yield* hasStagedChanges(git, directory)))
      return yield* operationFailure(
        "Incompatible",
        "Commit or unstage the staged changes first.",
      );
    const output = yield* git
      .run({
        directory,
        arguments: [
          "cherry-pick",
          ...(result === "stage" ? ["--no-commit"] : []),
          ...(mainline === null ? [] : ["-m", String(mainline)]),
          "--end-of-options",
          ...commits,
        ],
        timeoutMilliseconds: 120_000,
      })
      .pipe(Effect.mapError(uncertain), Effect.uninterruptible);
    const state = yield* coordination.operation(directory);
    if (
      output.exitCode !== 0 &&
      (state.kind === "cherry-pick" ||
        (result === "stage" && (yield* hasUnmergedPaths(git, directory))))
    )
      return started("Stopped", state);
    yield* requireGitSuccess(output);
    return started(result === "stage" ? "Staged" : "Committed", state);
  });
}

export function continueStagedCherryPick(
  git: GitCommandRunner,
  directory: string,
) {
  return Effect.gen(function* () {
    const sequencer = yield* readStagedSequencer(git, directory);
    if (sequencer === undefined) return false;
    yield* runRepositoryGit(git, directory, ["cherry-pick", "--quit"]);
    if (sequencer.remaining.length === 0) return true;
    const output = yield* git
      .run({
        directory,
        arguments: [
          "cherry-pick",
          "--no-commit",
          ...(sequencer.mainline === null ? [] : ["-m", sequencer.mainline]),
          "--end-of-options",
          ...sequencer.remaining,
        ],
        timeoutMilliseconds: 120_000,
      })
      .pipe(Effect.mapError(uncertain));
    if (output.exitCode !== 0 && !(yield* hasUnmergedPaths(git, directory)))
      yield* requireGitSuccess(output);
    return true;
  });
}

function readStagedSequencer(git: GitCommandRunner, directory: string) {
  return Effect.gen(function* () {
    const path = resolve(
      directory,
      (yield* runRepositoryGit(git, directory, [
        "rev-parse",
        "--git-path",
        "sequencer",
      ])).trim(),
    );
    const [options, todo] = yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          readFile(join(path, "opts"), "utf8"),
          readFile(join(path, "todo"), "utf8"),
        ]),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => [null, null] as const));
    if (options === null || todo === null) return undefined;
    if (!/no-commit\s*=\s*true/.test(options)) return undefined;
    return {
      mainline: /mainline\s*=\s*(\d+)/.exec(options)?.[1] ?? null,
      remaining: todo
        .split("\n")
        .flatMap((line) => /^(?:pick|p)\s+(\S+)/.exec(line)?.[1] ?? [])
        .slice(1),
    };
  });
}

function readParentCounts(
  git: GitCommandRunner,
  directory: string,
  commits: readonly string[],
) {
  return runRepositoryGit(git, directory, [
    "rev-list",
    "--no-walk=unsorted",
    "--parents",
    "--end-of-options",
    ...commits,
  ]).pipe(
    Effect.catchTag("GitFailed", () =>
      operationFailure(
        "Incompatible",
        "A selected commit is not in this repository.",
      ),
    ),
    Effect.map((output) =>
      output
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => line.split(" ").length - 1),
    ),
  );
}

function hasStagedChanges(git: GitCommandRunner, directory: string) {
  return runRepositoryGitOutput(
    git,
    directory,
    ["diff", "--cached", "--quiet"],
    { exitCodes: [0, 1] },
  ).pipe(Effect.map(({ exitCode }) => exitCode === 1));
}

function hasUnmergedPaths(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, ["ls-files", "--unmerged"]).pipe(
    Effect.map((unmerged) => unmerged.length > 0),
  );
}
