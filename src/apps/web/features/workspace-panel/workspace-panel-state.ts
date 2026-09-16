import type {
  WorkspacePanelAction,
  WorkspacePanelKind,
  WorkspacePanelState,
} from "#web/features/workspace-panel/workspace-panel.contract";
import {
  workspacePanelDefinitions,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel-definitions";

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

export function persistentWorkspacePanel(
  state: WorkspacePanelState,
): WorkspacePanelState {
  return state.tabs.reduce(
    (current, kind) =>
      workspacePanelDefinitions[kind].lifetime === "selection"
        ? reduceWorkspacePanel(current, { type: "close", kind })
        : current,
    state,
  );
}

function openPanel(
  state: WorkspacePanelState,
  kind: WorkspacePanelKind,
): WorkspacePanelState {
  if (!workspacePanelDefinitions[kind].available) return state;
  if (state.open && state.active === kind) return state;
  const selection = workspacePanelDefinitions[kind].lifetime === "selection";
  const previous =
    selection && state.returnTo && state.returnTo.kind !== kind
      ? reduceWorkspacePanel(state, {
          type: "close",
          kind: state.returnTo.kind,
        })
      : state;
  return {
    ...previous,
    ...(selection && !previous.tabs.includes(kind)
      ? {
          returnTo: {
            kind,
            active: previous.active,
            open: previous.open,
            expanded: previous.expanded === true,
          },
        }
      : {}),
    ...(selection ? { expanded: false } : {}),
    open: true,
    active: kind,
    tabs: previous.tabs.includes(kind)
      ? previous.tabs
      : [...previous.tabs, kind],
  };
}

function closePanel(
  state: WorkspacePanelState,
  kind: WorkspacePanelKind,
): WorkspacePanelState {
  const index = state.tabs.indexOf(kind);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab !== kind);
  if (state.returnTo?.kind === kind) {
    const { returnTo, ...rest } = state;
    if (state.active !== kind) return { ...rest, tabs };
    return {
      ...rest,
      tabs,
      active:
        returnTo.active !== null && tabs.includes(returnTo.active)
          ? returnTo.active
          : (tabs[0] ?? null),
      open: returnTo.open,
      expanded: returnTo.expanded,
    };
  }
  return {
    ...state,
    tabs,
    active:
      state.active === kind
        ? (tabs[index] ?? tabs[index - 1] ?? null)
        : state.active,
  };
}

export function reduceWorkspacePanel(
  state: WorkspacePanelState,
  action: WorkspacePanelAction,
): WorkspacePanelState {
  switch (action.type) {
    case "expand":
      if (
        state.active &&
        workspacePanelDefinitions[state.active].lifetime === "selection"
      )
        return state;
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
