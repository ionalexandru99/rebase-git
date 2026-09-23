import { createWorkspacePanelStore } from "#web/features/workspace-panel/persistence/workspace-panel-store";
import type {
  PanelViewState,
  WorkspacePanelScope,
} from "#web/features/workspace-panel/workspace-panel-session.contract";
import { createStore } from "#web/platform/store/store";

function createPanelSession(
  key: string,
  scope: WorkspacePanelScope | undefined,
  previousScopeKey: string | undefined,
) {
  const view = createStore<PanelViewState>({
    mounted: false,
    targets: {},
    contents: {},
  });
  return {
    key,
    scope,
    store: createWorkspacePanelStore(key, previousScopeKey),
    getSnapshot: view.getSnapshot,
    subscribe: view.subscribe,
    update: (next: Partial<PanelViewState>) =>
      view.set({ ...view.getSnapshot(), ...next }),
  };
}

export type PanelSession = ReturnType<typeof createPanelSession>;

export function createSessionCollection() {
  const sessions = new Map<string, PanelSession>();
  const snapshot = createStore<readonly PanelSession[]>([]);
  const publish = () => snapshot.set([...sessions.values()]);
  return {
    getSnapshot: snapshot.getSnapshot,
    subscribe: snapshot.subscribe,
    acquire: (
      key: string,
      scope: WorkspacePanelScope | undefined,
      previousScopeKey?: string,
    ) => {
      return (
        sessions.get(key) ?? createPanelSession(key, scope, previousScopeKey)
      );
    },
    attach: (session: PanelSession) => {
      sessions.set(session.key, session);
      session.update({ mounted: true });
      if (!snapshot.getSnapshot().includes(session)) {
        publish();
      }
      return () => session.update({ mounted: false, targets: {} });
    },
    retain: (repositoryIds: readonly string[]) => {
      let changed = false;
      for (const [key, session] of sessions) {
        if (
          session.scope &&
          !repositoryIds.includes(session.scope.repositoryId)
        ) {
          sessions.delete(key);
          changed = true;
        }
      }
      if (changed) {
        publish();
      }
    },
  };
}
