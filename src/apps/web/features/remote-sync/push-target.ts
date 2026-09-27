import type {
  PushBranch,
  PushDestination,
  PushRejected,
  RepositoryPushHttpApi,
  RepositoryRefs,
} from "@rebase/contracts";
import { describeFailure } from "#web/platform/query/request-failure";
import type {
  CommandFailure,
  CommandInput,
} from "#web/platform/query/use-command";

export type PushRequest = CommandInput<typeof RepositoryPushHttpApi.push>;

export interface ForcePushReview {
  readonly branch: string;
  readonly destination: PushDestination;
  readonly expectedOid: string;
  readonly removed: number;
}

export interface PushUpstream {
  readonly destination: PushDestination;
  readonly ahead: number;
  readonly behind: number;
  readonly gone: boolean;
  readonly remoteOid?: string;
}

export interface PushTarget {
  readonly branch: string;
  readonly remotes: readonly string[];
  readonly upstream?: PushUpstream;
}

export function resolvePushTarget(
  refs: RepositoryRefs | undefined,
  branch: string | undefined,
): PushTarget | undefined {
  if (refs === undefined || branch === undefined) return undefined;
  const remotes = (refs.remoteProviders ?? []).map(({ remote }) => remote);
  if (remotes.length === 0) return undefined;
  const upstream = refs.branches.find(
    (candidate) => candidate.name === branch,
  )?.upstream;
  const destination =
    upstream === undefined ? undefined : splitUpstream(upstream.name, remotes);
  if (upstream === undefined || destination === undefined)
    return { branch, remotes };
  const remoteOid = refs.remoteBranches.find(
    (candidate) => `${candidate.remote}/${candidate.name}` === upstream.name,
  )?.target;
  return {
    branch,
    remotes,
    upstream: {
      destination,
      ahead: upstream.ahead,
      behind: upstream.behind,
      gone: upstream.gone,
      ...(remoteOid === undefined ? {} : { remoteOid }),
    },
  };
}

function publishRemote(remotes: readonly string[]) {
  return remotes.includes("origin") ? "origin" : remotes[0];
}

export function destinationName({ remote, branch }: PushDestination) {
  return `${remote}/${branch}`;
}

function splitUpstream(
  name: string,
  remotes: readonly string[],
): PushDestination | undefined {
  const remote = remotes
    .filter((candidate) => name.startsWith(`${candidate}/`))
    .sort((left, right) => right.length - left.length)[0];
  return remote === undefined
    ? undefined
    : { remote, branch: name.slice(remote.length + 1) };
}

export function forcePushReview(
  target: PushTarget,
): ForcePushReview | undefined {
  const upstream = target.upstream;
  if (upstream?.remoteOid === undefined || upstream.gone) return undefined;
  return {
    branch: target.branch,
    destination: upstream.destination,
    expectedOid: upstream.remoteOid,
    removed: upstream.behind,
  };
}

export function fastForwardRequest(
  target: PushTarget,
): PushRequest | undefined {
  const upstream = target.upstream;
  const remote = publishRemote(target.remotes);
  const destination =
    upstream?.destination ??
    (remote === undefined ? undefined : { remote, branch: target.branch });
  if (destination === undefined) return undefined;
  return {
    branch: target.branch,
    destination,
    setUpstream: upstream === undefined,
    mode: { _tag: "FastForward" },
  };
}

export function forcePushRequest(review: ForcePushReview): PushRequest {
  return {
    branch: review.branch,
    destination: review.destination,
    setUpstream: false,
    mode: { _tag: "ForceWithLease", expectedOid: review.expectedOid },
  };
}

export function describeProgress({ destination, mode }: PushBranch) {
  return `${mode._tag === "ForceWithLease" ? "Force pushing" : "Pushing"} to ${destinationName(destination)}`;
}

export function describePushFailure(
  failure: CommandFailure<typeof RepositoryPushHttpApi.push>,
  destination: PushDestination,
) {
  return describeFailure(failure, {
    PushRejected: (rejected) => describePushRejection(rejected, destination),
  });
}

function describePushRejection(
  { reason, detail }: PushRejected,
  destination: PushDestination,
) {
  const name = destinationName(destination);
  switch (reason) {
    case "NonFastForward":
      return `Rejected: ${name} has commits you don't have. Fetch first.`;
    case "LeaseRejected":
      return `Rejected: ${name} moved since your last fetch. Fetch and review.`;
    case "HookDeclined":
      return `Rejected by hook: ${detail}`;
    case "Authentication":
      return `${destination.remote} rejected the credentials.`;
    case "Network":
      return `Can't reach ${destination.remote}.`;
    case "RemoteMissing":
      return `Remote ${destination.remote} not found.`;
    default:
      return detail || "Push failed.";
  }
}
