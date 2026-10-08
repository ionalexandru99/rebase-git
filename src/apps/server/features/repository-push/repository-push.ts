import { Effect, Result } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  PushBranch,
  PushDestination,
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
  type GitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  classifyPushFailure,
  pushError,
  pushRefStatus,
} from "#server/features/repository-push/git/push-failures.ts";
import { reconcileRemoteBranch } from "#server/features/repository-push/git/reconcile-remote-branch.ts";

const pushTimeoutMilliseconds = 6 * 60 * 60_000;

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
      target,
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
    const exit = yield* Effect.result(
      git.run({
        directory: worktreePath,
        arguments: [
          "push",
          "--porcelain",
          "--atomic",
          remote,
          ...refs.map((ref) => `${ref}:${ref}`),
        ],
        timeoutMilliseconds: pushTimeoutMilliseconds,
      }),
    );
    if (Result.isFailure(exit)) {
      yield* requireRemoteTags(git, worktreePath, remote, refs, exit.failure);
      return { remote, pushed: [...tags], upToDate: [] } satisfies TagsPushed;
    }
    const output = exit.success;
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

function requireRemoteTags(
  git: GitCommandRunner,
  directory: string,
  remote: string,
  refs: readonly string[],
  failure: GitFailed,
) {
  return Effect.gen(function* () {
    const [listed, local] = yield* Effect.all([
      runRepositoryGit(
        git,
        directory,
        ["ls-remote", "--refs", remote, ...refs],
        {
          timeoutMilliseconds: pushTimeoutMilliseconds,
        },
      ),
      runRepositoryGit(git, directory, ["rev-parse", ...refs]),
    ]);
    const arrived = new Map(
      listed
        .split("\n")
        .map((line) => line.split("\t"))
        .map(([oid, ref]) => [ref, oid]),
    );
    const sent = local.trim().split("\n");
    if (refs.some((ref, index) => arrived.get(ref) !== sent[index]))
      return yield* Effect.fail(processFailure(failure));
  });
}

function processFailure(failure: GitFailed) {
  return repositoryRejected(
    "GitFailed",
    `Git could not run the push (${failure.reason}).`,
  );
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
  target: string,
) {
  const destinationRef = `refs/heads/${destination.branch}`;
  return git
    .run({
      directory,
      arguments: ["push", "--porcelain", "--progress", ...args],
      environment: { GIT_LFS_FORCE_PROGRESS: "1" },
      timeoutMilliseconds: pushTimeoutMilliseconds,
    })
    .pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          reconcileRemoteBranch(git, directory, destination).pipe(
            Effect.flatMap((remoteTarget) =>
              remoteTarget === target
                ? Effect.void
                : Effect.fail(processFailure(failure)),
            ),
          ),
        onSuccess: (output) => requirePushed(output, destinationRef),
      }),
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
