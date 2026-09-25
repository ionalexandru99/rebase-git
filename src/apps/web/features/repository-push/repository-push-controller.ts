import type {
  OperationScope,
  PushBranch,
  PushDestination,
  RemoteBranchUpdated,
} from "@rebase/contracts";
import { Effect, type Fiber, type ManagedRuntime } from "effect";
import type {
  PushTarget,
  RepositoryPushClient,
  RepositoryPushError,
  RepositoryPushState,
} from "#web/features/repository-push/repository-push.contract";
import {
  destinationName,
  publishRemote,
} from "#web/features/repository-push/resolve-push-target";
import { createControllerScope } from "#web/platform/effect/controller-scope";
import { createStore } from "#web/platform/store/store";

export function createRepositoryPushController(
  client: RepositoryPushClient,
  scope: OperationScope,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
) {
  const work = createControllerScope(runtime);
  const store = createStore<RepositoryPushState>({
    connected: false,
    running: null,
    review: null,
    notice: null,
  });
  let running: Fiber.Fiber<void> | undefined;
  const publish = (next: Partial<RepositoryPushState>) => {
    if (work.open) store.set({ ...store.getSnapshot(), ...next });
  };

  const run = (
    message: string,
    destination: PushDestination,
    request: Effect.Effect<RemoteBranchUpdated, RepositoryPushError>,
  ) => {
    const { connected, running: current } = store.getSnapshot();
    if (!connected || current !== null) return;
    publish({ running: { message }, review: null, notice: null });
    running = work.fork(
      request.pipe(
        Effect.match({
          onSuccess: () => null,
          onFailure: (error) => describePushFailure(error, destination),
        }),
        Effect.flatMap((notice) =>
          Effect.sync(() => publish({ running: null, notice })),
        ),
        Effect.onInterrupt(() =>
          Effect.sync(() =>
            publish({
              running: null,
              notice: `Cancelled. ${destinationName(destination)} reflects what reached the remote.`,
            }),
          ),
        ),
      ),
    );
  };

  const pushBranch = (
    command: Omit<PushBranch, "repositoryId" | "worktreePath">,
  ) =>
    run(
      `${command.mode._tag === "ForceWithLease" ? "Force pushing" : "Pushing"} to ${destinationName(command.destination)}`,
      command.destination,
      client.push({ ...scope, ...command }),
    );

  const requestForcePush = (target: PushTarget) => {
    const upstream = target.upstream;
    if (upstream?.remoteOid === undefined || upstream.gone) return;
    publish({
      review: {
        branch: target.branch,
        destination: upstream.destination,
        expectedOid: upstream.remoteOid,
        removed: upstream.behind,
      },
      notice: null,
    });
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    start: () => {
      work.start();
    },
    stop: work.stop,
    connect: (connected: boolean) => publish({ connected }),
    push: (target: PushTarget) => {
      const upstream = target.upstream;
      if (upstream !== undefined && !upstream.gone && upstream.behind > 0) {
        requestForcePush(target);
        return;
      }
      const remote = publishRemote(target.remotes);
      const destination =
        upstream?.destination ??
        (remote === undefined ? undefined : { remote, branch: target.branch });
      if (destination === undefined) return;
      pushBranch({
        branch: target.branch,
        destination,
        setUpstream: upstream === undefined,
        mode: { _tag: "FastForward" },
      });
    },
    requestForcePush,
    confirm: () => {
      const { review } = store.getSnapshot();
      if (review !== null)
        pushBranch({
          branch: review.branch,
          destination: review.destination,
          setUpstream: false,
          mode: { _tag: "ForceWithLease", expectedOid: review.expectedOid },
        });
    },
    cancel: () => {
      if (store.getSnapshot().running === null) publish({ review: null });
      else work.interrupt(running);
    },
    dismiss: () => publish({ notice: null }),
  };
}

export type RepositoryPushController = ReturnType<
  typeof createRepositoryPushController
>;

function describePushFailure(
  error: RepositoryPushError,
  destination: PushDestination,
) {
  const name = destinationName(destination);
  switch (error.reason) {
    case "NonFastForward":
      return `Rejected: ${name} has commits you don't have. Fetch first.`;
    case "LeaseRejected":
      return `Rejected: ${name} moved since your last fetch. Fetch and review.`;
    case "HookDeclined":
      return `Rejected by hook: ${error.detail}`;
    case "Authentication":
      return `${destination.remote} rejected the credentials.`;
    case "Network":
      return `Can't reach ${destination.remote}.`;
    case "RemoteMissing":
      return `Remote ${destination.remote} not found.`;
    case "Busy":
      return "Another Git operation is running.";
    case "Denied":
      return "No write access to this repository.";
    case "Disconnected":
      return `Connection lost. ${name} refreshes on reconnect.`;
    default:
      return error.detail || "Push failed.";
  }
}
