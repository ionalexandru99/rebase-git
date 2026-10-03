import { Effect } from "effect";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import type {
  PushBranch,
  PushDestination,
  PushRejected,
  PushTags,
  RemoteBranchUpdated,
  TagsPushed,
} from "#contracts/repository-push/repository-push.contract.ts";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandOutput,
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  classifyPushFailure,
  pushError,
  pushRefStatus,
} from "#server/features/repository-push/git/push-failures.ts";
import {
  reconcileRemoteBranch,
  uncertainPush,
} from "#server/features/repository-push/git/reconcile-remote-branch.ts";

const pushTimeoutMilliseconds = 120_000;

function pushRemoteBranch(git: GitCommandRunner, command: PushBranch) {
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

function pushTagsToRemote(
  git: GitCommandRunner,
  { worktreePath, remote, tags }: PushTags,
) {
  const refs = tags.map((tag) => `refs/tags/${tag}`);
  return Effect.gen(function* () {
    yield* requireRemote(git, worktreePath, remote);
    const output = yield* git
      .run({
        directory: worktreePath,
        arguments: [
          "push",
          "--porcelain",
          "--atomic",
          remote,
          ...refs.map((ref) => `${ref}:${ref}`),
        ],
        timeoutMilliseconds: pushTimeoutMilliseconds,
      })
      .pipe(
        Effect.mapError((error) =>
          error.reason === "Timeout"
            ? pushError(
                "Uncertain",
                `The push to ${remote} did not finish. Fetch to see which tags arrived.`,
              )
            : repositoryRejected(
                "GitFailed",
                `Git could not run the push (${error.reason}).`,
              ),
        ),
      );
    const statuses = tags.map((tag, index) => ({
      tag,
      status: pushRefStatus(output.stdout, refs[index] ?? ""),
    }));
    if (output.exitCode === 0)
      return {
        remote,
        pushed: statuses
          .filter(({ status }) => status?.flag !== "=")
          .map(({ tag }) => tag),
        upToDate: statuses
          .filter(({ status }) => status?.flag === "=")
          .map(({ tag }) => tag),
      } satisfies TagsPushed;
    const existing = statuses
      .filter(({ status }) => status?.summary.includes("(already exists)"))
      .map(({ tag }) => tag);
    return yield* Effect.fail(
      existing.length > 0
        ? pushError("TagExists", existing.join(", "))
        : classifyPushFailure(output, refs[0] ?? ""),
    );
  });
}

function requireRemote(
  git: GitCommandRunner,
  directory: string,
  remote: string,
) {
  return runRepositoryGit(git, directory, ["remote"]).pipe(
    Effect.flatMap((remotes) =>
      remotes.split("\n").includes(remote)
        ? Effect.void
        : Effect.fail(
            pushError(
              "RemoteMissing",
              `The remote "${remote}" does not exist.`,
            ),
          ),
    ),
  );
}

function requireDestination(
  git: GitCommandRunner,
  directory: string,
  { remote, branch }: PushDestination,
) {
  return Effect.gen(function* () {
    yield* requireRemote(git, directory, remote);
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
      arguments: ["push", "--porcelain", "--progress", ...args],
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

export function repositoryPushFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command } = repositoryRoutes(dependencies);
  return {
    routes: [
      command(
        RepositoryPushApi.push,
        { name: "push", locks: { refs: "wait" }, duringOperation: "block" },
        (input, git) => pushRemoteBranch(git, input),
      ),
      command(
        RepositoryPushApi.pushTags,
        { name: "push", locks: { refs: "wait" }, duringOperation: "proceed" },
        (input, git) => pushTagsToRemote(git, input),
      ),
    ],
  };
}
