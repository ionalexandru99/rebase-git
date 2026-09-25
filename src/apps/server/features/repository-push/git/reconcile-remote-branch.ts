import type { PushDestination } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { pushError } from "#server/features/repository-push/git/push-failures";
import { runRepositoryGit } from "#server/repository/access/index";

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

export function uncertainPush(
  git: GitCommandRunner,
  directory: string,
  destination: PushDestination,
) {
  const name = `${destination.remote}/${destination.branch}`;
  return reconcileRemoteBranch(git, directory, destination).pipe(
    Effect.map((target) =>
      target === null
        ? `Push unconfirmed. ${name} no longer exists.`
        : `Push unconfirmed. ${name} is at ${target.slice(0, 8)}.`,
    ),
    Effect.orElseSucceed(
      () => `Push unconfirmed and ${name} could not be read. Fetch to check.`,
    ),
    Effect.flatMap((detail) => Effect.fail(pushError("Uncertain", detail))),
  );
}
