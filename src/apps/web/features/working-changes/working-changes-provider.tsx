import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useOperationRecovery } from "#web/features/operation-recovery/index";
import type { RepositoryChangesClient } from "#web/features/working-changes/working-changes.contract";
import {
  createWorkingChangesController,
  type WorkingChangesController,
} from "#web/features/working-changes/working-changes-controller";

const WorkingChangesContext = createContext<WorkingChangesController | null>(
  null,
);
export function WorkingChangesProvider({
  children,
  client,
  environmentId,
  repositoryId,
  worktreePath,
  onCommitted,
}: {
  readonly children: ReactNode;
  readonly client: RepositoryChangesClient;
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly onCommitted: () => void;
}) {
  const { controller: recovery, state: operationState } =
    useOperationRecovery();
  const controller = useMemo(
    () =>
      createWorkingChangesController(
        client,
        { repositoryId, worktreePath, amend: false },
        JSON.stringify([environmentId, repositoryId, worktreePath]),
        onCommitted,
        recovery?.refresh,
      ),
    [client, environmentId, repositoryId, worktreePath, onCommitted, recovery],
  );
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  const revision = operationState?.operation?.revision;
  const busy = operationState?.busy ?? false;
  const previousOperation = useRef({ revision, busy });
  useEffect(() => {
    const previous = previousOperation.current;
    previousOperation.current = { revision, busy };
    if (
      (previous.revision !== undefined && previous.revision !== revision) ||
      (previous.busy && !busy)
    )
      controller.refresh();
  }, [controller, revision, busy]);
  return (
    <WorkingChangesContext.Provider value={controller}>
      {children}
    </WorkingChangesContext.Provider>
  );
}
export function useWorkingChanges() {
  const controller = useContext(WorkingChangesContext);
  if (controller === null)
    throw new Error("Working changes require a provider.");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, state };
}
