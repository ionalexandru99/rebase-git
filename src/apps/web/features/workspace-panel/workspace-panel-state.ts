import {
  isSingleKind,
  type WorkspacePanelKind,
  workspacePanelDefinitions,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import type {
  WorkspacePanelAction,
  WorkspacePanelState,
  WorkspacePanelTab,
} from "#web/features/workspace-panel/workspace-panel-model.ts";

export const initialWorkspacePanelState: WorkspacePanelState = {
  tabs: [],
  active: null,
  open: false,
  width: 40,
};

export function isWorkspacePanelKind(
  value: unknown,
): value is WorkspacePanelKind {
  return workspacePanelKinds.some((kind) => kind === value);
}

export function tabKind(tab: WorkspacePanelTab): WorkspacePanelKind {
  const separator = tab.indexOf(":");
  const kind = separator < 0 ? tab : tab.slice(0, separator);
  if (!isWorkspacePanelKind(kind))
    throw new Error(`Unknown workspace panel tab ${tab}.`);
  return kind;
}

export function instanceTab(
  kind: WorkspacePanelKind,
  input: unknown,
): WorkspacePanelTab | undefined {
  const instance = workspacePanelDefinitions[kind].instance?.(input);
  return instance === undefined ? undefined : `${kind}:${instance.key}`;
}

export function isPanelTab(tab: string, input: unknown) {
  const separator = tab.indexOf(":");
  const kind = separator < 0 ? tab : tab.slice(0, separator);
  if (!isWorkspacePanelKind(kind)) return false;
  return isSingleKind(kind) ? separator < 0 : instanceTab(kind, input) === tab;
}

function openTab(
  state: WorkspacePanelState,
  tab: WorkspacePanelTab,
): WorkspacePanelState {
  if (state.open && state.active === tab) {
    return state;
  }
  return {
    ...state,
    open: true,
    active: tab,
    tabs: state.tabs.includes(tab) ? state.tabs : [...state.tabs, tab],
  };
}

function closeTab(
  state: WorkspacePanelState,
  tab: WorkspacePanelTab,
): WorkspacePanelState {
  const index = state.tabs.indexOf(tab);
  if (index < 0) {
    return state;
  }
  const tabs = state.tabs.filter((candidate) => candidate !== tab);
  const inputs = { ...state.inputs };
  delete inputs[tab];
  const active =
    state.active === tab
      ? (tabs[index] ?? tabs[index - 1] ?? null)
      : state.active;
  return {
    ...state,
    tabs,
    inputs,
    active,
  };
}

function setInput(
  state: WorkspacePanelState,
  tab: WorkspacePanelTab,
  input: unknown,
): WorkspacePanelState {
  return state.inputs?.[tab] === input
    ? state
    : { ...state, inputs: { ...state.inputs, [tab]: input } };
}

export function reduceWorkspacePanel(
  state: WorkspacePanelState,
  action: WorkspacePanelAction,
): WorkspacePanelState {
  switch (action.type) {
    case "input":
      return setInput(state, action.kind, action.input);
    case "expand":
      return { ...state, expanded: action.expanded };
    case "open": {
      if (!("input" in action)) return openTab(state, action.kind);
      const tab = instanceTab(action.kind, action.input);
      if (tab === undefined) return state;
      return openTab(
        state.tabs.includes(tab) ? state : setInput(state, tab, action.input),
        tab,
      );
    }
    case "select":
      return state.tabs.includes(action.tab)
        ? openTab(state, action.tab)
        : state;
    case "close":
      return closeTab(state, action.tab);
    case "visibility":
      return state.open === action.open
        ? state
        : { ...state, open: action.open };
    case "resize": {
      const width = Math.round(action.width * 100) / 100;
      return !Number.isFinite(width) ||
        width < 15 ||
        width > 70 ||
        width === state.width
        ? state
        : { ...state, width };
    }
  }
}
