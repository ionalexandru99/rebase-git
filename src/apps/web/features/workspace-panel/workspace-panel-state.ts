import {
  workspacePanelDefinitions,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel-definitions";
import type {
  WorkspacePanelAction,
  WorkspacePanelKind,
  WorkspacePanelState,
} from "#web/features/workspace-panel/workspace-panel-model";

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

function openPanel(
  state: WorkspacePanelState,
  kind: WorkspacePanelKind,
): WorkspacePanelState {
  if (!workspacePanelDefinitions[kind].available) {
    return state;
  }
  if (state.open && state.active === kind) {
    return state;
  }
  return {
    ...state,
    open: true,
    active: kind,
    tabs: state.tabs.includes(kind) ? state.tabs : [...state.tabs, kind],
  };
}

function closePanel(
  state: WorkspacePanelState,
  kind: WorkspacePanelKind,
): WorkspacePanelState {
  const index = state.tabs.indexOf(kind);
  if (index < 0) {
    return state;
  }
  const tabs = state.tabs.filter((tab) => tab !== kind);
  const inputs = { ...state.inputs };
  delete inputs[kind];
  const active =
    state.active === kind
      ? (tabs[index] ?? tabs[index - 1] ?? null)
      : state.active;
  return {
    ...state,
    tabs,
    inputs,
    active,
  };
}

export function reduceWorkspacePanel(
  state: WorkspacePanelState,
  action: WorkspacePanelAction,
): WorkspacePanelState {
  switch (action.type) {
    case "input":
      return state.inputs?.[action.kind] === action.input
        ? state
        : {
            ...state,
            inputs: { ...state.inputs, [action.kind]: action.input },
          };
    case "expand":
      return { ...state, expanded: action.expanded };
    case "open":
      return openPanel(state, action.kind);
    case "close":
      return closePanel(state, action.kind);
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
