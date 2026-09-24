import type {
  WorkspacePanelState,
  WorkspacePanelStore,
} from "#web/features/workspace-panel/workspace-panel.contract";
import { workspacePanelDefinitions } from "#web/features/workspace-panel/workspace-panel-definitions";
import {
  initialWorkspacePanelState,
  isWorkspacePanelKind,
  reduceWorkspacePanel,
} from "#web/features/workspace-panel/workspace-panel-state";
import { createStore } from "#web/platform/store/store";

const panelStoragePrefix = "rebase:workspace-panel:v1:";

export function createWorkspacePanelStore(
  scopeKey: string,
  previousScopeKey?: string,
): WorkspacePanelStore {
  const key = `${panelStoragePrefix}${scopeKey}`;
  const store = createStore(readPanelState(key, previousScopeKey));
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispatch: (action) => {
      const state = store.getSnapshot();
      const next = reduceWorkspacePanel(state, action);
      if (next === state) return;
      savePanelState(key, JSON.stringify(next));
      store.set(next);
    },
  };
}

function savePanelState(key: string, serialized: string) {
  try {
    localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

function readPanelState(
  key: string,
  previousScopeKey: string | undefined,
): WorkspacePanelState {
  try {
    let serialized = localStorage.getItem(key);
    if (serialized === null && previousScopeKey !== undefined) {
      const previous = localStorage.getItem(
        `${panelStoragePrefix}${previousScopeKey}`,
      );
      if (
        previous !== null &&
        !hasMigratedLayout(previousScopeKey, key) &&
        savePanelState(key, previous)
      ) {
        serialized = previous;
      }
    }
    const saved: unknown = JSON.parse(serialized ?? "null");
    if (saved === null || typeof saved !== "object")
      return initialWorkspacePanelState;
    if (!("tabs" in saved) || !Array.isArray(saved.tabs))
      return initialWorkspacePanelState;
    const tabs = [...new Set(saved.tabs.filter(isWorkspacePanelKind))].filter(
      (kind) => workspacePanelDefinitions[kind].available,
    );
    const active =
      "active" in saved &&
      isWorkspacePanelKind(saved.active) &&
      tabs.includes(saved.active)
        ? saved.active
        : (tabs[0] ?? null);
    const storedInputs = "inputs" in saved ? saved.inputs : undefined;
    const inputs =
      typeof storedInputs === "object" && storedInputs !== null
        ? Object.fromEntries(
            tabs.flatMap((kind) => {
              const input: unknown = Reflect.get(storedInputs, kind);
              return workspacePanelDefinitions[kind].acceptsInput?.(input)
                ? [[kind, input]]
                : [];
            }),
          )
        : {};
    return {
      tabs,
      inputs,
      expanded: "expanded" in saved && saved.expanded === true,
      active,
      open:
        "open" in saved && typeof saved.open === "boolean"
          ? saved.open
          : initialWorkspacePanelState.open,
      width:
        "width" in saved &&
        typeof saved.width === "number" &&
        Number.isFinite(saved.width) &&
        saved.width >= 15 &&
        saved.width <= 70
          ? saved.width
          : initialWorkspacePanelState.width,
    };
  } catch {
    return initialWorkspacePanelState;
  }
}

function hasMigratedLayout(previousScopeKey: string, currentKey: string) {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (
      key === null ||
      key === currentKey ||
      !key.startsWith(panelStoragePrefix)
    ) {
      continue;
    }
    const savedScopeKey = key.slice(panelStoragePrefix.length);
    if (!savedScopeKey.startsWith("[")) {
      continue;
    }
    let scope: unknown;
    try {
      scope = JSON.parse(savedScopeKey);
    } catch {
      continue;
    }
    if (
      Array.isArray(scope) &&
      scope.length === 4 &&
      JSON.stringify([scope[0], scope[2], scope[3]]) === previousScopeKey
    ) {
      return true;
    }
  }
  return false;
}
