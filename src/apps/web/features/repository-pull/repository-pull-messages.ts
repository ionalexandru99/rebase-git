import type { PullHttpFailure } from "@rebase/contracts";
import { describeRepositoryFetchError } from "#web/features/repository-fetch/index";
import {
  RepositoryPullDisconnected,
  RepositoryPullRejected,
} from "#web/features/repository-pull/repository-pull.contract";

export function describeRepositoryPullError(branch: string, error: unknown) {
  if (error instanceof RepositoryPullRejected)
    return describePullFailure(branch, error.failure);
  if (error instanceof RepositoryPullDisconnected)
    return "Reconnect to the server and try again.";
  return describeRepositoryFetchError(error);
}

function describePullFailure(branch: string, failure: PullHttpFailure) {
  switch (failure._tag) {
    case "PullDiverged":
      return `Can't fast-forward ${branch}. It has ${commits(failure.ahead)} that ${failure.upstream} doesn't, and ${failure.upstream} has ${commits(failure.behind)} it doesn't. Merge or rebase to combine them.`;
    case "PullWouldOverwrite":
      return `Pull stopped. Nothing changed. Your edits to ${files(failure.paths)} overlap incoming changes. Commit or discard them, then pull again.`;
    case "UpstreamMissing":
      return failure.upstream === undefined
        ? `${branch} has no upstream branch to pull from.`
        : `${failure.upstream} no longer exists on the remote.`;
    case "PullBlocked":
      return failure.detail;
    case "PullUncertain":
      return `The pull may not have finished. Check ${branch} before pulling again.`;
    case "BranchMissing":
      return `${branch} no longer exists.`;
    case "RepositoryMissing":
      return "The repository is no longer available.";
    case "CapabilityDenied":
      return "You do not have permission to change this repository.";
    default:
      return `Git couldn't pull ${branch}. Try again.`;
  }
}

function commits(count: number) {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

function files(paths: readonly string[]) {
  const [first, ...rest] = paths;
  if (first === undefined) return "some files";
  if (rest.length === 0) return first;
  return `${first} and ${rest.length} other ${rest.length === 1 ? "file" : "files"}`;
}
