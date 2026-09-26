import type { PushDestination, RepositoryRefs } from "@rebase/contracts";

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

export function publishRemote(remotes: readonly string[]) {
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
