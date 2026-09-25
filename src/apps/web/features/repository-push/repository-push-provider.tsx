import type { EnvironmentRequestClient } from "@rebase/environment-client";
import type { ManagedRuntime } from "effect";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { RepositoryPushState } from "#web/features/repository-push/repository-push.contract";
import {
  createRepositoryPushController,
  type RepositoryPushController,
} from "#web/features/repository-push/repository-push-controller";
import { repositoryPushClient } from "#web/features/repository-push/transport/repository-push-client";
import { useStore } from "#web/platform/store/use-store";

const RepositoryPushContext = createContext<RepositoryPushController | null>(
  null,
);

export function RepositoryPushProvider({
  requests,
  runtime,
  scope,
  connected,
  children,
}: {
  readonly requests: EnvironmentRequestClient | undefined;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
  readonly scope:
    | { readonly repositoryId: string; readonly worktreePath: string }
    | undefined;
  readonly connected: boolean;
  readonly children: ReactNode;
}) {
  const repositoryId = scope?.repositoryId;
  const worktreePath = scope?.worktreePath;
  const controller = useMemo(
    () =>
      requests === undefined ||
      repositoryId === undefined ||
      worktreePath === undefined
        ? null
        : createRepositoryPushController(
            repositoryPushClient(requests),
            { repositoryId, worktreePath },
            runtime,
          ),
    [requests, repositoryId, worktreePath, runtime],
  );
  useEffect(() => {
    if (controller === null) return;
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => controller?.connect(connected), [controller, connected]);
  return (
    <RepositoryPushContext.Provider value={controller}>
      {children}
    </RepositoryPushContext.Provider>
  );
}

const idleStore = {
  getSnapshot: () => null,
  subscribe: () => () => {},
};

export function useRepositoryPush() {
  const controller = useContext(RepositoryPushContext);
  const state = useStore<RepositoryPushState | null>(controller ?? idleStore);
  return controller === null || state === null ? null : { controller, state };
}
