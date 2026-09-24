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
  onCommitted,
  runtime,
  active = true,
}: {
  readonly children: ReactNode;
  readonly client: RepositoryChangesClient;
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly changes: EnvironmentChanges | undefined;
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
export function useWorkingChanges() {
  const controller = useContext(WorkingChangesContext);
  if (controller === null)
    throw new Error("Working changes require a provider.");
  const state = useStore(controller);
  return { controller, state };
}
