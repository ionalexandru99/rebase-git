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
import { createStoredStore } from "#web/platform/store/stored-store.ts";

export function createWorkspacePanelStore(key: string): WorkspacePanelStore {
  const store = createStoredStore(
    `rebase:workspace-panel:v1:${key}`,
    decodePanelState,
  );
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispatch: (action) =>
      store.set(reduceWorkspacePanel(store.getSnapshot(), action)),
  };
}

function decodePanelState(saved: unknown): WorkspacePanelState {
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
}
