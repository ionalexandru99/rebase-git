import {
  type PushBranch,
  type PushDestination,
  type PushRejected,
  type RemoteBranchUpdated,
  type RepositoryRejected,
  repositoryRejected,
} from "@rebase/contracts";
import { Effect } from "effect";
import type {
  GitCommandOutput,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import {
  classifyPushFailure,
  pushError,
  pushRefStatus,
} from "#server/features/repository-push/git/push-failures";
import {
  reconcileRemoteBranch,
  uncertainPush,
} from "#server/features/repository-push/git/reconcile-remote-branch";
import { runRepositoryGit } from "#server/repository/access/index";

const pushTimeoutMilliseconds = 120_000;

export function pushRemoteBranch(git: GitCommandRunner, command: PushBranch) {
  const directory = command.worktreePath;
  const destinationRef = `refs/heads/${command.destination.branch}`;
  return Effect.gen(function* () {
    yield* requireDestination(git, directory, command.destination);
    const target = yield* readBranchTip(git, directory, command.branch);
    yield* runPush(
      git,
      directory,
      [
        ...(command.setUpstream ? ["--set-upstream"] : []),
        ...(command.mode._tag === "ForceWithLease"
          ? [`--force-with-lease=${destinationRef}:${command.mode.expectedOid}`]
          : []),
        command.destination.remote,
        `refs/heads/${command.branch}:${destinationRef}`,
      ],
      command.destination,
    );
    return {
      destination: command.destination,
      target,
    } satisfies RemoteBranchUpdated;
  });
}

function requireDestination(
  git: GitCommandRunner,
  directory: string,
  { remote, branch }: PushDestination,
) {
  return Effect.gen(function* () {
    const remotes = yield* runRepositoryGit(git, directory, ["remote"]);
    if (!remotes.split("\n").includes(remote))
      return yield* Effect.fail(
        pushError("RemoteMissing", `The remote "${remote}" does not exist.`),
      );
    yield* runRepositoryGit(git, directory, [
      "check-ref-format",
      `refs/heads/${branch}`,
    ]).pipe(
      Effect.mapError(() =>
        pushError("InvalidBranch", `"${branch}" is not a valid branch name.`),
      ),
    );
  });
}

function readBranchTip(
  git: GitCommandRunner,
  directory: string,
  branch: string,
) {
  return runRepositoryGit(git, directory, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}^{commit}`,
  ]).pipe(
    Effect.map((output) => output.trim()),
    Effect.mapError(() =>
      pushError("InvalidBranch", `The branch "${branch}" does not exist.`),
    ),
  );
}

function runPush(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  destination: PushDestination,
) {
  const destinationRef = `refs/heads/${destination.branch}`;
  return git
    .run({
      directory,
      arguments: ["push", "--porcelain", ...args],
      timeoutMilliseconds: pushTimeoutMilliseconds,
    })
    .pipe(
      Effect.catch(
        (error): Effect.Effect<never, PushRejected | RepositoryRejected> =>
          error.reason === "Timeout"
            ? uncertainPush(git, directory, destination)
            : Effect.fail(
                repositoryRejected(
                  "GitFailed",
                  `Git could not run the push (${error.reason}).`,
                ),
              ),
      ),
      Effect.flatMap((output) => requirePushed(output, destinationRef)),
      Effect.onInterrupt(() =>
        reconcileRemoteBranch(git, directory, destination).pipe(Effect.ignore),
      ),
    );
}

function requirePushed(output: GitCommandOutput, destinationRef: string) {
  const status = pushRefStatus(output.stdout, destinationRef);
  return output.exitCode === 0 && status !== undefined && status.flag !== "!"
    ? Effect.void
    : Effect.fail(classifyPushFailure(output, destinationRef));
}
