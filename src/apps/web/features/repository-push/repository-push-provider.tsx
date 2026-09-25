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
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { useStore } from "#web/platform/store/use-store";

const RepositoryPushContext = createContext<RepositoryPushController | null>(
  null,
);

export function RepositoryPushProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const scope = useRepositoryScope();
  const target = scope?.target;
  const connected = scope?.connected ?? false;
  const controller = useMemo(
    () =>
      target === undefined
        ? null
        : createRepositoryPushController(
            repositoryPushClient(target.requests),
            {
              repositoryId: target.repositoryId,
              worktreePath: target.worktreePath,
            },
            target.runtime,
          ),
    [target],
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
