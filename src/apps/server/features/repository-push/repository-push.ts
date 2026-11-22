import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  PushBranch,
  PushDestination,
  PushTags,
  RemoteBranchUpdated,
  TagsPushed,
} from "#contracts/repository-push/repository-push.contract.ts";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import {
  currentRequest,
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
  uninterruptible,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandOutput,
  type GitCommandRunner,
  type GitFailed,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  classifyPushFailure,
  pushError,
  pushRefStatus,
} from "#server/features/repository-push/git/push-failures.ts";
import { reconcileRemoteBranch } from "#server/features/repository-push/git/reconcile-remote-branch.ts";

const pushTimeoutMilliseconds = 6 * 60 * 60_000;

async function pushRemoteBranch(
  git: GitCommandRunner,
  command: PushBranch,
): Promise<RemoteBranchUpdated> {
  const directory = command.worktreePath;
  const destinationRef = `refs/heads/${command.destination.branch}`;
  await requireDestination(git, directory, command.destination);
  const target = await readBranchTip(git, directory, command.branch);
  await runPush(
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
  return { destination: command.destination, target };
}

async function pushTagsToRemote(
  git: GitCommandRunner,
  { worktreePath, remote, tags }: PushTags,
): Promise<TagsPushed> {
  const refs = tags.map((tag) => `refs/tags/${tag}`);
  await requireRemote(git, worktreePath, remote);
  let output: GitCommandOutput;
  try {
    output = await git.run({
      directory: worktreePath,
      arguments: [
        "push",
        "--porcelain",
        "--atomic",
        remote,
        ...refs.map((ref) => `${ref}:${ref}`),
      ],
      timeoutMilliseconds: pushTimeoutMilliseconds,
    });
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    await requireRemoteTags(git, worktreePath, remote, refs, error);
    return { remote, pushed: [...tags], upToDate: [] };
  }
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
    };
  const existing = statuses
    .filter(({ status }) => status?.summary.includes("(already exists)"))
    .map(({ tag }) => tag);
  throw existing.length > 0
    ? pushError("TagExists", existing.join(", "))
    : classifyPushFailure(output, refs[0] ?? "");
}

async function requireRemoteTags(
  git: GitCommandRunner,
  directory: string,
  remote: string,
  refs: readonly string[],
  failure: GitFailed,
) {
  const listed = await runRepositoryGit(
    git,
    directory,
    ["ls-remote", "--refs", remote, ...refs],
    { timeoutMilliseconds: pushTimeoutMilliseconds },
  );
  const local = await runRepositoryGit(git, directory, ["rev-parse", ...refs]);
  const arrived = new Map(
    listed
      .split("\n")
      .map((line) => line.split("\t"))
      .map(([oid, ref]) => [ref, oid]),
  );
  const sent = local.trim().split("\n");
  if (refs.some((ref, index) => arrived.get(ref) !== sent[index]))
    throw processFailure(failure);
}

function processFailure(failure: GitFailed) {
  return repositoryRejected(
    "GitFailed",
    `Git could not run the push (${failure.reason}).`,
  );
}

async function requireRemote(
  git: GitCommandRunner,
  directory: string,
  remote: string,
) {
  const remotes = await runRepositoryGit(git, directory, ["remote"]);
  if (!remotes.split("\n").includes(remote))
    throw pushError("RemoteMissing", `The remote "${remote}" does not exist.`);
}

async function requireDestination(
  git: GitCommandRunner,
  directory: string,
  { remote, branch }: PushDestination,
) {
  await requireRemote(git, directory, remote);
  try {
    await runRepositoryGit(git, directory, [
      "check-ref-format",
      `refs/heads/${branch}`,
    ]);
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw pushError("InvalidBranch", `"${branch}" is not a valid branch name.`);
  }
}

async function readBranchTip(
  git: GitCommandRunner,
  directory: string,
  branch: string,
) {
  try {
    return (
      await runRepositoryGit(git, directory, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${branch}^{commit}`,
      ])
    ).trim();
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw pushError("InvalidBranch", `The branch "${branch}" does not exist.`);
  }
}

async function runPush(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  destination: PushDestination,
  target: string,
) {
  const destinationRef = `refs/heads/${destination.branch}`;
  let output: GitCommandOutput;
  try {
    output = await git.run({
      directory,
      arguments: ["push", "--porcelain", "--progress", ...args],
      environment: { GIT_LFS_FORCE_PROGRESS: "1" },
      timeoutMilliseconds: pushTimeoutMilliseconds,
    });
  } catch (error) {
    if (currentRequest()?.signal.aborted) {
      await uninterruptible(() =>
        reconcileRemoteBranch(git, directory, destination),
      ).catch(() => undefined);
      throw error;
    }
    if (!isGitFailed(error)) throw error;
    if ((await reconcileRemoteBranch(git, directory, destination)) !== target)
      throw processFailure(error);
    return;
  }
  requirePushed(output, destinationRef);
}

function requirePushed(output: GitCommandOutput, destinationRef: string) {
  const status = pushRefStatus(output.stdout, destinationRef);
  if (output.exitCode !== 0 || status === undefined || status.flag === "!")
    throw classifyPushFailure(output, destinationRef);
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
