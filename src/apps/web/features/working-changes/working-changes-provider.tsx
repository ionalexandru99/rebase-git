import type { ManagedRuntime } from "effect";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { RepositoryChangesClient } from "#web/features/working-changes/working-changes.contract";
import {
  createWorkingChangesController,
  type WorkingChangesController,
} from "#web/features/working-changes/working-changes-controller";
import { useStore } from "#web/platform/store/use-store";

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
  runtime,
  active = true,
}: {
  readonly children: ReactNode;
  readonly client: RepositoryChangesClient;
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly onCommitted: () => void;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
  readonly active?: boolean;
}) {
  const controller = useMemo(
    () =>
      createWorkingChangesController(
        client,
        { repositoryId, worktreePath, amend: false },
        JSON.stringify([environmentId, repositoryId, worktreePath]),
        onCommitted,
        runtime,
      ),
    [client, environmentId, repositoryId, worktreePath, onCommitted, runtime],
  );
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => controller.setActive(active), [controller, active]);
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
  const state = useStore(controller);
  return { controller, state };
}
