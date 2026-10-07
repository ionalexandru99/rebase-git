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
  WorkspaceWidths,
} from "#web/features/workspace-panel/workspace-panel-model.ts";

export const workspaceWidths = {
  sidebar: { initial: 16, min: 12, max: 26 },
  panel: { initial: 36, min: 20, max: Number.POSITIVE_INFINITY },
  graph: { min: 36 },
};

export const initialWorkspacePanelState: WorkspacePanelState = {
  tabs: [],
  active: null,
  open: false,
  widths: {
    sidebar: workspaceWidths.sidebar.initial,
    panel: workspaceWidths.panel.initial,
  },
};

export function readWorkspaceWidths(value: unknown): WorkspaceWidths {
  const widths = typeof value === "object" && value !== null ? value : {};
  return {
    sidebar: readWidth(Reflect.get(widths, "sidebar"), workspaceWidths.sidebar),
    panel: readWidth(Reflect.get(widths, "panel"), workspaceWidths.panel),
  };
}

function readWidth(
  value: unknown,
  { initial, min, max }: { initial: number; min: number; max: number },
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value * 100) / 100))
    : initial;
}

export function fitWorkspace({
  width,
  rem,
  widths,
  open,
}: {
  readonly width: number;
  readonly rem: number;
  readonly widths: WorkspaceWidths;
  readonly open: boolean;
}) {
  let overflow =
    widths.sidebar +
    (open ? widths.panel : 0) +
    workspaceWidths.graph.min -
    width / rem;
  const shrink = (size: number, min: number) => {
    const cut = Math.min(Math.max(overflow, 0), Math.max(size - min, 0));
    overflow -= cut;
    return size - cut;
  };
  const sidebar = shrink(widths.sidebar, workspaceWidths.sidebar.min) * rem;
  const panel = open
    ? shrink(widths.panel, workspaceWidths.panel.min) * rem
    : 0;
  return { sidebar, panel };
}

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

function replaceTab(
  state: WorkspacePanelState,
  previous: WorkspacePanelTab,
  next: WorkspacePanelTab,
  input: unknown,
): WorkspacePanelState {
  if (previous === next || !state.tabs.includes(previous)) return state;
  if (state.tabs.includes(next))
    return openTab(closeTab(state, previous), next);
  const inputs = { ...state.inputs, [next]: input };
  delete inputs[previous];
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab === previous ? next : tab)),
    inputs,
    active: state.active === previous ? next : state.active,
  };
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
    case "replace": {
      const previous = instanceTab(action.kind, action.previous);
      const next = instanceTab(action.kind, action.input);
      return previous === undefined || next === undefined
        ? state
        : replaceTab(state, previous, next, action.input);
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
      const widths = readWorkspaceWidths(action.widths);
      return widths.sidebar === state.widths.sidebar &&
        widths.panel === state.widths.panel
        ? state
        : { ...state, widths };
    }
  }
}
