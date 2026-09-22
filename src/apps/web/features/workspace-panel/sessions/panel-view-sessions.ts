import { createWorkspacePanelStore } from "#web/features/workspace-panel/persistence/workspace-panel-store";
import type {
  PanelViewState,
  WorkspacePanelScope,
} from "#web/features/workspace-panel/workspace-panel-session.contract";

function createPanelSession(
  key: string,
  scope: WorkspacePanelScope | undefined,
) {
  const store = createWorkspacePanelStore(key);
  let state: PanelViewState = { mounted: false, targets: {}, contents: {} };
  const listeners = new Set<() => void>();
  return {
    key,
    scope,
    store,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (next: Partial<PanelViewState>) => {
      state = { ...state, ...next };
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

export type PanelSession = ReturnType<typeof createPanelSession>;

export function createSessionCollection() {
  const sessions = new Map<string, PanelSession>();
  let snapshot: readonly PanelSession[] = [];
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = [...sessions.values()];
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    acquire: (key: string, scope: WorkspacePanelScope | undefined) => {
      return sessions.get(key) ?? createPanelSession(key, scope);
    },
    attach: (session: PanelSession) => {
      sessions.set(session.key, session);
      session.update({ mounted: true });
      if (!snapshot.includes(session)) {
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
