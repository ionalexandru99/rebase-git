import {
  type PushBranch,
  type PushDestination,
  RepositoryPushHttpApi,
} from "@rebase/contracts";
import { useEffect, useState } from "react";
import {
  describePushFailure,
  describePushProgress,
} from "#web/features/repository-push/push-messages";
import {
  type PushTarget,
  publishRemote,
} from "#web/features/repository-push/resolve-push-target";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { useCommand } from "#web/platform/query/use-command";

export interface ForcePushReview {
  readonly branch: string;
  readonly destination: PushDestination;
  readonly expectedOid: string;
  readonly removed: number;
}

type PushRequest = Omit<PushBranch, "repositoryId" | "worktreePath">;

export function usePush() {
  const scope = useRepositoryScope();
  const command = useCommand(RepositoryPushHttpApi.push, { repository: scope });
  const [review, setReview] = useState<ForcePushReview | null>(null);
  const worktreePath = scope?.worktreePath;
  const { cancel, reset } = command;
  useEffect(() => {
    if (worktreePath === undefined) return;
    return () => {
      cancel();
      reset();
      setReview(null);
    };
  }, [worktreePath, cancel, reset]);
  const connected = scope?.connected ?? false;
  const running =
    command.isPending && command.variables !== undefined
      ? describePushProgress(command.variables)
      : null;
  const notice =
    command.isError && command.variables !== undefined
      ? describePushFailure(command.error, command.variables.destination)
      : null;

  const pushBranch = (request: PushRequest) => {
    if (scope === undefined || !connected || command.isPending) return;
    setReview(null);
    command.mutate({
      repositoryId: scope.repositoryId,
      worktreePath: scope.worktreePath,
      ...request,
    });
  };

  const requestForcePush = (target: PushTarget) => {
    const review = forcePushReview(target);
    if (review === undefined || command.isPending) return;
    command.reset();
    setReview(review);
  };

  return {
    connected,
    running,
    review,
    notice,
    push: (target: PushTarget) => {
      const upstream = target.upstream;
      if (upstream !== undefined && !upstream.gone && upstream.behind > 0) {
        requestForcePush(target);
        return;
      }
      const request = fastForwardRequest(target);
      if (request !== undefined) pushBranch(request);
    },
    requestForcePush,
    confirm: () => {
      if (review !== null) pushBranch(forcePushRequest(review));
    },
    cancel: () => {
      if (command.isPending) command.cancel();
      else setReview(null);
    },
  };
}

export type Push = ReturnType<typeof usePush>;

function forcePushReview(target: PushTarget): ForcePushReview | undefined {
  const upstream = target.upstream;
  if (upstream?.remoteOid === undefined || upstream.gone) return undefined;
  return {
    branch: target.branch,
    destination: upstream.destination,
    expectedOid: upstream.remoteOid,
    removed: upstream.behind,
  };
}

function fastForwardRequest(target: PushTarget): PushRequest | undefined {
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

function forcePushRequest(review: ForcePushReview): PushRequest {
  return {
    branch: review.branch,
    destination: review.destination,
    setUpstream: false,
    mode: { _tag: "ForceWithLease", expectedOid: review.expectedOid },
  };
}
