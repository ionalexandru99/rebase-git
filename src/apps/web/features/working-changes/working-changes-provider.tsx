import type { ManagedRuntime } from "effect";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { RepositoryChangesClient } from "#web/features/working-changes/working-changes.contract";
import {
  createWorkingChangesController,
  type WorkingChangesController,
  type WorkingChangesState,
} from "#web/features/working-changes/working-changes-controller";
import { browserWorkingChangesStore } from "#web/persistence/working-changes/working-changes-store";
import type { EnvironmentChanges } from "#web/platform/environment/environment-protocol.contract";
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
  changes,
  runtime,
  active = true,
}: {
  readonly children: ReactNode;
  readonly client: RepositoryChangesClient;
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly changes: EnvironmentChanges | undefined;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
  readonly active?: boolean;
}) {
  const controller = useMemo(
    () =>
      createWorkingChangesController(
        client,
        browserWorkingChangesStore,
        { repositoryId, worktreePath, amend: false },
        JSON.stringify([environmentId, repositoryId, worktreePath]),
        runtime,
      ),
    [client, environmentId, repositoryId, worktreePath, runtime],
  );
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => controller.setActive(active), [controller, active]);
  useEffect(
    () =>
      changes?.subscribe((repositoryIds) => {
        if (repositoryIds === undefined || repositoryIds.includes(repositoryId))
          controller.invalidate();
      }),
    [changes, controller, repositoryId],
  );
  useEffect(() => {
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
    <WorkingChangesContext.Provider value={controller}>
      {children}
    </WorkingChangesContext.Provider>
  );
}
export function useWorkingChangesController() {
  const controller = useContext(WorkingChangesContext);
  if (controller === null)
    throw new Error("Working changes require a provider.");
  return controller;
}
export function useWorkingChanges<Key extends keyof WorkingChangesState>(
  key: Key,
): WorkingChangesState[Key] {
  const select = useCallback((state: WorkingChangesState) => state[key], [key]);
  return useStore(useWorkingChangesController(), select);
}
export function useCommitDraft() {
  return useStore(useWorkingChangesController().draft);
}
