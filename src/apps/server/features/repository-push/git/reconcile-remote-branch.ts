import { Effect } from "effect";
import type { PushDestination } from "#contracts/repository-push/repository-push.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

const reconcileTimeoutMilliseconds = 30_000;

export function reconcileRemoteBranch(
  git: GitCommandRunner,
  directory: string,
  { remote, branch }: PushDestination,
) {
  const remoteRef = `refs/heads/${branch}`;
  const trackingRef = `refs/remotes/${remote}/${branch}`;
  const options = { timeoutMilliseconds: reconcileTimeoutMilliseconds };
  return Effect.gen(function* () {
    const listed = yield* runRepositoryGit(
      git,
      directory,
      ["ls-remote", "--refs", remote, remoteRef],
      options,
    );
    const target = listed.split("\t")[0]?.trim() || null;
    if (target === null)
      yield* runRepositoryGit(
        git,
        directory,
        ["update-ref", "-d", trackingRef],
        options,
      );
    else
      yield* runRepositoryGit(
        git,
        directory,
        [
          "fetch",
          "--no-tags",
          "--no-write-fetch-head",
          remote,
          `+${remoteRef}:${trackingRef}`,
        ],
        options,
      );
    return target;
  });
}
