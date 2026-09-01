import type {
  LocalBranch,
  RemoteBranch,
  RemoteDefaultBranch,
  RepositoryTag,
} from "@rebase/contracts";

export const forEachRefFormat = [
  "%(refname)",
  "%(objectname)",
  "%(objecttype)",
  "%(*objectname)",
  "%(*objecttype)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(worktreepath)",
  "%(symref)",
].join("%00");

export interface ForEachRefRecord {
  readonly commit: string;
  readonly name: string;
  readonly objectType: string;
  readonly peeledObject: string;
  readonly peeledObjectType: string;
  readonly symref: string;
  readonly track: string;
  readonly upstream: string;
  readonly worktreePath: string;
}

const localBranchPrefix = "refs/heads/";
const remoteBranchPrefix = "refs/remotes/";
const tagPrefix = "refs/tags/";

export function parseForEachRef(stdout: string): readonly ForEachRefRecord[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [
        name,
        commit,
        objectType,
        peeledObject,
        peeledObjectType,
        upstream,
        track,
        worktreePath,
        symref,
      ] = line.split("\0");
      return name === undefined || commit === undefined
        ? []
        : [
            {
              commit,
              name,
              objectType: objectType ?? "",
              peeledObject: peeledObject ?? "",
              peeledObjectType: peeledObjectType ?? "",
              symref: symref ?? "",
              track: track ?? "",
              upstream: upstream ?? "",
              worktreePath: worktreePath ?? "",
            },
          ];
    });
}

export function localBranchFromRecord(
  record: ForEachRefRecord,
): LocalBranch | undefined {
  if (!record.name.startsWith(localBranchPrefix) || record.symref.length > 0) {
    return undefined;
  }
  return {
    name: record.name.slice(localBranchPrefix.length),
    target: record.commit,
    ...(record.upstream.length === 0
      ? {}
      : {
          upstream: {
            ...parseTracking(record.track),
            name: record.upstream,
          },
        }),
    ...(record.worktreePath.length === 0
      ? {}
      : { worktreePath: record.worktreePath }),
  };
}

export function remoteBranchFromRecord(
  record: ForEachRefRecord,
): RemoteBranch | undefined {
  if (!record.name.startsWith(remoteBranchPrefix) || record.symref.length > 0) {
    return undefined;
  }
  const qualified = record.name.slice(remoteBranchPrefix.length);
  const separator = qualified.indexOf("/");
  if (separator <= 0 || separator === qualified.length - 1) {
    return undefined;
  }
  return {
    name: qualified.slice(separator + 1),
    remote: qualified.slice(0, separator),
    target: record.commit,
  };
}

export function remoteDefaultBranchFromRecord(
  record: ForEachRefRecord,
): RemoteDefaultBranch | undefined {
  if (
    !record.name.startsWith(remoteBranchPrefix) ||
    !record.name.endsWith("/HEAD") ||
    !record.symref.startsWith(remoteBranchPrefix)
  ) {
    return undefined;
  }
  const remote = record.name.slice(remoteBranchPrefix.length, -"/HEAD".length);
  const target = record.symref.slice(remoteBranchPrefix.length);
  if (!target.startsWith(`${remote}/`)) {
    return undefined;
  }
  const name = target.slice(remote.length + 1);
  return name.length === 0 ? undefined : { name, remote };
}

export function tagFromRecord(
  record: ForEachRefRecord,
): RepositoryTag | undefined {
  if (!record.name.startsWith(tagPrefix)) {
    return undefined;
  }
  const target =
    record.objectType === "commit"
      ? record.commit
      : record.peeledObjectType === "commit"
        ? record.peeledObject
        : undefined;
  return target === undefined
    ? undefined
    : { name: record.name.slice(tagPrefix.length), target };
}

function parseTracking(track: string) {
  return {
    ahead: trackingCount(track, "ahead"),
    behind: trackingCount(track, "behind"),
    gone: track === "gone",
  };
}

function trackingCount(track: string, direction: "ahead" | "behind") {
  const match = new RegExp(`${direction} (\\d+)`).exec(track);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}
