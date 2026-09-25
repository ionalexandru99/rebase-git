import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { OperationRecoveryState } from "#web/features/operation-recovery/operation-recovery.contract";
import {
  createOperationRecoveryController,
  type OperationRecoveryController,
} from "#web/features/operation-recovery/operation-recovery-controller";
import { repositoryOperationsClient } from "#web/features/operation-recovery/transport/repository-operations-client";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { useStore } from "#web/platform/store/use-store";

interface OperationRecoveryScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
}

const OperationRecoveryContext = createContext<{
  readonly controller: OperationRecoveryController;
  readonly scope: OperationRecoveryScope;
} | null>(null);

export function OperationRecoveryProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const repositoryScope = useRepositoryScope();
  const target = repositoryScope?.target;
  const connected = repositoryScope?.connected ?? false;
  const recovery = useMemo(() => {
    if (target === undefined) return null;
    const scope = {
      repositoryId: target.repositoryId,
      worktreePath: target.worktreePath,
    };
    return {
      controller: createOperationRecoveryController(
        repositoryOperationsClient(target.requests),
        scope,
        target.runtime,
      ),
      scope,
    };
  }, [target]);
  const controller = recovery?.controller;
  useEffect(() => {
    if (controller === undefined) return;
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => controller?.connect(connected), [controller, connected]);
  useEffect(() => {
    if (controller === undefined || target === undefined) return;
    return target.changes.subscribe((repositoryIds) => {
      if (
        repositoryIds === undefined ||
        repositoryIds.includes(target.repositoryId)
      )
        controller.invalidate();
    });
  }, [controller, target]);
  useEffect(() => {
    if (controller === undefined) return;
    const invalidateWhenVisible = () => {
      if (document.visibilityState === "visible") controller.invalidate();
    };
    window.addEventListener("focus", invalidateWhenVisible);
    document.addEventListener("visibilitychange", invalidateWhenVisible);
    return () => {
      window.removeEventListener("focus", invalidateWhenVisible);
      document.removeEventListener("visibilitychange", invalidateWhenVisible);
    };
  }, [controller]);
  return (
    <OperationRecoveryContext.Provider value={recovery}>
      {children}
    </OperationRecoveryContext.Provider>
  );
}

const idleStore = {
  getSnapshot: () => null,
  subscribe: () => () => {},
};

export function useOperationRecovery() {
  const recovery = useContext(OperationRecoveryContext);
  const state = useStore<OperationRecoveryState | null>(
    recovery?.controller ?? idleStore,
  );
  return recovery === null || state === null
    ? null
    : { controller: recovery.controller, state };
}

export function useOperationCommandState(): "busy" | "idle" {
  const recovery = useContext(OperationRecoveryContext);
  return useStore<OperationRecoveryState | null, "busy" | "idle">(
    recovery?.controller ?? idleStore,
    commandState,
  );
}

export function useWorktreeOperation(
  scope: OperationRecoveryScope | undefined,
) {
  const recovery = useContext(OperationRecoveryContext);
  const matches =
    recovery !== null &&
    scope !== undefined &&
    recovery.scope.repositoryId === scope.repositoryId &&
    recovery.scope.worktreePath === scope.worktreePath;
  return useStore<OperationRecoveryState | null>(
    matches ? recovery.controller : idleStore,
  );
}

function commandState(state: OperationRecoveryState | null) {
  return state !== null &&
    (state.busy ||
      state.checking ||
      (state.operation !== null && state.operation.kind !== "idle"))
    ? "busy"
    : "idle";
}
