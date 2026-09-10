import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { matchesKeyboardShortcut } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type { KeyboardShortcutCommandId } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";
import { createWorkspacePanelStore } from "#web/features/workspace-panel/persistence/workspace-panel-store";
import type {
  WorkspacePanelAction,
  WorkspacePanelStore,
} from "#web/features/workspace-panel/workspace-panel.contract";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";

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
  const toggleRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const emptyStateRef = useRef<HTMLHeadingElement>(null);
  const execute = useCallback(
    (action: WorkspacePanelAction) => {
      store.dispatch(action);
      if (action.type !== "resize") setFocusRequest((request) => request + 1);
    },
    [store],
  );
  const openLauncher = useCallback(() => {
    if (store.getSnapshot().tabs.length === 0) {
      execute({ type: "visibility", open: true });
      return;
    }
    store.dispatch({ type: "visibility", open: true });
    setLauncherOpen(true);
  }, [execute, store, setLauncherOpen]);
  return {
    panelId: `side-panel:${scopeKey}`,
    store,
    execute,
    launcherOpen,
    setLauncherOpen,
    openLauncher,
    focusRequest,
    toggleRef,
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
  commandsActive,
}: {
  readonly children: ReactNode;
  readonly scopeKey: string;
  readonly commandsActive: boolean;
}) {
  const controller = usePanelController(scopeKey);
  const { bindings, platform } = useKeyboardShortcuts();
  const { store, execute, openLauncher, toggleRef } = controller;
  useEffect(() => {
    if (!commandsActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return;
      const state = store.getSnapshot();
      const commands: readonly [
        KeyboardShortcutCommandId,
        boolean,
        () => void,
      ][] = [
        [
          "workspacePanel.toggle",
          true,
          () => {
            execute({ type: "visibility", open: !state.open });
            if (state.open) toggleRef.current?.focus();
          },
        ],
        ["workspacePanel.openTab", true, openLauncher],
        [
          "workspacePanel.closeTab",
          state.open && state.active !== null,
          () => {
            if (state.active !== null)
              execute({ type: "close", kind: state.active });
          },
        ],
        [
          "workspacePanel.previousTab",
          state.open,
          () => execute({ type: "cycle", offset: -1 }),
        ],
        [
          "workspacePanel.nextTab",
          state.open,
          () => execute({ type: "cycle", offset: 1 }),
        ],
      ];
      const command = commands.find(
        ([id, enabled]) =>
          enabled && matchesKeyboardShortcut(event, bindings[id], platform),
      );
      if (command === undefined) return;
      event.preventDefault();
      command[2]();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    bindings,
    commandsActive,
    execute,
    openLauncher,
    platform,
    store,
    toggleRef,
  ]);
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
