import {
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react";
import type {
  WorkspacePanelAction,
  WorkspacePanelStore,
} from "#web/features/workspace-panel/workspace-panel-model.ts";
import {
  usePanelSession,
  type WorkspacePanelScope,
} from "#web/features/workspace-panel/workspace-panel-sessions.tsx";
import { useStore } from "#web/platform/store/use-store.ts";

function usePanelController(scope: WorkspacePanelScope) {
  const session = usePanelSession(scope);
  const store = session.store;
  const [launcher, setLauncher] = useState<{
    store: WorkspacePanelStore;
    open: boolean;
  }>();
  const launcherOpen = launcher?.store === store && launcher.open;
  const setLauncherOpen = (open: boolean) => setLauncher({ store, open });
  const launcherRef = useRef<HTMLButtonElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const emptyStateRef = useRef<HTMLHeadingElement>(null);
  const focusPending = useRef(false);
  const focusPanel = () => {
    focusPending.current = false;
    const tab = tabListRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    (tab ?? emptyStateRef.current)?.focus();
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const dispatch = (action: WorkspacePanelAction) => {
    const before = store.getSnapshot();
    store.dispatch(action);
    if (!focusesPanel(action)) return;
    if (store.getSnapshot() === before && !launcherOpen) focusPanel();
    else focusPending.current = true;
  };
  const settleFocus = () => {
    if (focusPending.current && !launcherOpen) focusPanel();
  };
  return {
    session,
    panelId: `side-panel:${session.key}`,
    store,
    dispatch,
    settleFocus,
    launcherOpen,
    setLauncherOpen,
    launcherRef,
    tabListRef,
    emptyStateRef,
  };
}

function focusesPanel(action: WorkspacePanelAction) {
  if (action.type === "open") return action.focus !== false;
  return (
    action.type !== "resize" &&
    action.type !== "expand" &&
    action.type !== "input"
  );
}

const WorkspacePanelContext = createContext<
  ReturnType<typeof usePanelController> | undefined
>(undefined);

export function WorkspacePanelProvider({
  children,
  scope,
}: {
  readonly children: ReactNode;
  readonly scope: WorkspacePanelScope;
}) {
  const controller = usePanelController(scope);
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
  const state = useStore(controller.store);
  return { ...controller, state };
}
