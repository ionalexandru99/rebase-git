import {
  type WorkspacePanelAction,
  type WorkspacePanelKind,
  type WorkspacePanelState,
  workspacePanelAvailability,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel.contract";

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

export function reduceWorkspacePanel(
  state: WorkspacePanelState,
  action: WorkspacePanelAction,
): WorkspacePanelState {
  switch (action.type) {
    case "open":
      if (!workspacePanelAvailability[action.kind]) return state;
      if (state.open && state.active === action.kind) return state;
      return {
        ...state,
        open: true,
        active: action.kind,
        tabs: state.tabs.includes(action.kind)
          ? state.tabs
          : [...state.tabs, action.kind],
      };
    case "close": {
      const index = state.tabs.indexOf(action.kind);
      if (index < 0) return state;
      const tabs = state.tabs.filter((kind) => kind !== action.kind);
      return {
        ...state,
        tabs,
        active:
          state.active === action.kind
            ? (tabs[index] ?? tabs[index - 1] ?? null)
            : state.active,
      };
    }
    case "cycle": {
      if (state.tabs.length < 2) return state;
      const index =
        state.active === null ? 0 : state.tabs.indexOf(state.active);
      return {
        ...state,
        active:
          state.tabs[
            (index + action.offset + state.tabs.length) % state.tabs.length
          ] ?? null,
      };
    }
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
