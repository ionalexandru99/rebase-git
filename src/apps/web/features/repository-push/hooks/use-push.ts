import {
  type PushBranch,
  type PushDestination,
  type PushRejected,
  RepositoryPushHttpApi,
} from "@rebase/contracts";
import { useEffect, useState } from "react";
import {
  destinationName,
  type PushTarget,
  publishRemote,
} from "#web/features/repository-push/resolve-push-target";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import { describeFailure } from "#web/platform/query/request-failure";
import {
  type CommandFailure,
  type CommandInput,
  useCommand,
} from "#web/platform/query/use-command";

export interface ForcePushReview {
  readonly branch: string;
  readonly destination: PushDestination;
  readonly expectedOid: string;
  readonly removed: number;
}

type PushRequest = CommandInput<typeof RepositoryPushHttpApi.push>;

export function usePush() {
  const command = useCommand(RepositoryPushHttpApi.push);
  const [review, setReview] = useState<ForcePushReview | null>(null);
  const worktreePath = useRepositoryScope()?.worktreePath;
  const { cancel, reset } = command;
  useEffect(() => {
    if (worktreePath === undefined) return;
    return () => {
      cancel();
      reset();
      setReview(null);
    };
  }, [worktreePath, cancel, reset]);
  const running =
    command.running && command.input !== undefined
      ? describeProgress(command.input)
      : null;
  const notice =
    command.failure !== undefined && command.input !== undefined
      ? describePushFailure(command.failure, command.input.destination)
      : null;

  const pushBranch = (request: PushRequest) => {
    if (!command.canRun || command.running) return;
    setReview(null);
    void command.run(request);
  };

  const requestForcePush = (target: PushTarget) => {
    const review = forcePushReview(target);
    if (review === undefined || command.running) return;
    command.reset();
    setReview(review);
  };

  return {
    connected: command.canRun,
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
      if (command.running) command.cancel();
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

function describeProgress({ destination, mode }: PushBranch) {
  return `${mode._tag === "ForceWithLease" ? "Force pushing" : "Pushing"} to ${destinationName(destination)}`;
}

function describePushFailure(
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
