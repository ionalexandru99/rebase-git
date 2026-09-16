import type { OperationScope } from "@rebase/contracts/repository-operations/repository-operations.contract";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { RepositoryOperationsClient } from "#web/features/operation-recovery/operation-recovery.contract";
import {
  createOperationRecoveryController,
  type OperationRecoveryController,
} from "#web/features/operation-recovery/operation-recovery-controller";

const OperationRecoveryContext =
  createContext<OperationRecoveryController | null>(null);

export function OperationRecoveryProvider({
  client,
  scope,
  connected,
  invalidate,
  children,
}: {
  readonly client: RepositoryOperationsClient;
  readonly scope: OperationScope;
  readonly connected: boolean;
  readonly invalidate: () => void;
  readonly children: ReactNode;
}) {
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const { repositoryId, worktreePath } = scope;
  const controller = useMemo(
    () =>
      createOperationRecoveryController(
        client,
        { repositoryId, worktreePath },
        () => invalidateRef.current(),
      ),
    [client, repositoryId, worktreePath],
  );
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => {
    controller.connect(connected);
  }, [controller, connected]);
  useEffect(() => {
    const refresh = () => controller.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [controller]);
  return (
    <OperationRecoveryContext.Provider value={controller}>
      {children}
    </OperationRecoveryContext.Provider>
  );
}

const subscribeNothing = () => () => {};
const emptySnapshot = () => null;
export function useOperationRecovery() {
  const controller = useContext(OperationRecoveryContext);
  const state = useSyncExternalStore(
    controller?.subscribe ?? subscribeNothing,
    controller?.getSnapshot ?? emptySnapshot,
  );
  return { controller, state };
}

export function useOperationCommandState(): "busy" | "idle" {
  const controller = useContext(OperationRecoveryContext);
  return useSyncExternalStore(controller?.subscribe ?? subscribeNothing, () => {
    const state = controller?.getSnapshot();
    return state?.busy ||
      state?.checking ||
      (state?.operation && state.operation.kind !== "idle")
      ? "busy"
      : "idle";
  });
}
