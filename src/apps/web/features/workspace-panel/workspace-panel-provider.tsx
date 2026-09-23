import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type {
  WorkspacePanelAction,
  WorkspacePanelStore,
} from "#web/features/workspace-panel/workspace-panel.contract";
import { useStore } from "#web/platform/store/use-store";
import {
  usePanelSession,
  usePanelSessionOwner,
  type WorkspacePanelScope,
  WorkspacePanelSessions,
} from "#web-ui/features/workspace-panel/workspace-panel-sessions";

function usePanelController(
  scopeKey: string,
  scope: WorkspacePanelScope | undefined,
) {
  const sessionKey = scope
    ? JSON.stringify([
        scope.environmentId,
        scope.repositoryId,
        scope.logicalRepositoryId,
        scope.worktreePath,
      ])
    : scopeKey;
  const session = usePanelSession(sessionKey, scope, scopeKey);
  const store = session.store;
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
      if (
        action.type !== "resize" &&
        action.type !== "expand" &&
        action.type !== "input"
      )
        setFocusRequest((request) => request + 1);
    },
    [store],
  );
  return {
    session,
    panelId: `side-panel:${sessionKey}`,
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
  scope,
}: {
  readonly children: ReactNode;
  readonly scopeKey: string;
  readonly scope?: WorkspacePanelScope | undefined;
}) {
  const owner = usePanelSessionOwner();
  if (!owner) {
    return (
      <WorkspacePanelSessions>
        <PanelProvider scopeKey={scopeKey} scope={scope}>
          {children}
        </PanelProvider>
      </WorkspacePanelSessions>
    );
  }
  return (
    <PanelProvider scopeKey={scopeKey} scope={scope}>
      {children}
    </PanelProvider>
  );
}

function PanelProvider({
  children,
  scopeKey,
  scope,
}: {
  readonly children: ReactNode;
  readonly scopeKey: string;
  readonly scope: WorkspacePanelScope | undefined;
}) {
  const controller = usePanelController(scopeKey, scope);
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
