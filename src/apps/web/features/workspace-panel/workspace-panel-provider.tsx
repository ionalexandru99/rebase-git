import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createWorkspacePanelStore } from "#web/features/workspace-panel/persistence/workspace-panel-store";
import type {
  WorkspacePanelAction,
  WorkspacePanelStore,
} from "#web/features/workspace-panel/workspace-panel.contract";

function usePanelController(scopeKey: string) {
  const store = useMemo(() => createWorkspacePanelStore(scopeKey), [scopeKey]);
  const [launcher, setLauncher] = useState<{
    store: WorkspacePanelStore;
    open: boolean;
  }>();
  const launcherOpen = launcher?.store === store && launcher.open;
  const setLauncherOpen = useCallback(
    (open: boolean) => setLauncher({ store, open }),
    [store],
  );
  const [focusRequest, setFocusRequest] = useState(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const emptyStateRef = useRef<HTMLHeadingElement>(null);
  const execute = useCallback(
    (action: WorkspacePanelAction) => {
      store.dispatch(action);
      if (action.type !== "resize" && action.type !== "expand")
        setFocusRequest((request) => request + 1);
    },
    [store],
  );
  return {
    panelId: `side-panel:${scopeKey}`,
    store,
    execute,
    launcherOpen,
    setLauncherOpen,
    focusRequest,
    launcherRef,
    emptyStateRef,
  };
}

const WorkspacePanelContext = createContext<
  ReturnType<typeof usePanelController> | undefined
>(undefined);

export function WorkspacePanelProvider({
  children,
  scopeKey,
}: {
  readonly children: ReactNode;
  readonly scopeKey: string;
}) {
  const controller = usePanelController(scopeKey);
  return (
    <WorkspacePanelContext.Provider value={controller}>
      {children}
    </WorkspacePanelContext.Provider>
  );
}

export function useWorkspacePanel() {
  const controller = useContext(WorkspacePanelContext);
  if (controller === undefined)
    throw new Error("WorkspacePanel requires its Provider.");
  const state = useSyncExternalStore(
    controller.store.subscribe,
    controller.store.getSnapshot,
    controller.store.getSnapshot,
  );
  return { ...controller, state };
}
