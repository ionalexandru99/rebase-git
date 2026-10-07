import { workspacePanelDefinitions } from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import type {
  WorkspacePanelState,
  WorkspacePanelStore,
} from "#web/features/workspace-panel/workspace-panel-model.ts";
import {
  initialWorkspacePanelState,
  isPanelTab,
  readWorkspaceWidths,
  reduceWorkspacePanel,
  tabKind,
} from "#web/features/workspace-panel/workspace-panel-state.ts";
import { createStore } from "#web/platform/store/store.ts";

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
    const storedInputs = "inputs" in saved ? saved.inputs : undefined;
    const savedInput = (tab: string): unknown =>
      typeof storedInputs === "object" && storedInputs !== null
        ? Reflect.get(storedInputs, tab)
        : undefined;
    const tabs = [
      ...new Set(
        saved.tabs.filter(
          (tab: unknown): tab is string =>
            typeof tab === "string" && isPanelTab(tab, savedInput(tab)),
        ),
      ),
    ];
    const active =
      "active" in saved &&
      typeof saved.active === "string" &&
      tabs.includes(saved.active)
        ? saved.active
        : (tabs[0] ?? null);
    const inputs = Object.fromEntries(
      tabs.flatMap((tab) => {
        const input = savedInput(tab);
        return workspacePanelDefinitions[tabKind(tab)].acceptsInput?.(input)
          ? [[tab, input]]
          : [];
      }),
    );
    return {
      tabs,
      inputs,
      expanded: "expanded" in saved && saved.expanded === true,
      active,
      open:
        "open" in saved && typeof saved.open === "boolean"
          ? saved.open
          : initialWorkspacePanelState.open,
      widths: readWorkspaceWidths("widths" in saved ? saved.widths : undefined),
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
