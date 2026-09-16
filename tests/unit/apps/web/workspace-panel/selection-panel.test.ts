import { describe, expect, it, vi } from "vitest";
import {
  initialWorkspacePanelState,
  persistentWorkspacePanel,
  reduceWorkspacePanel,
} from "#web/features/workspace-panel/workspace-panel-state";

vi.mock(
  "#web/features/workspace-panel/workspace-panel-definitions",
  async (original) => {
    const module =
      await original<
        typeof import("#web/features/workspace-panel/workspace-panel-definitions")
      >();
    return {
      ...module,
      workspacePanelDefinitions: {
        ...module.workspacePanelDefinitions,
        code: {
          ...module.workspacePanelDefinitions.code,
          available: true,
          lifetime: "selection",
        },
        "pull-request": {
          ...module.workspacePanelDefinitions["pull-request"],
          available: true,
          lifetime: "selection",
        },
      },
    };
  },
);

describe("selection panels", () => {
  const previous = {
    ...initialWorkspacePanelState,
    tabs: ["changes"] as const,
    active: "changes" as const,
    expanded: true,
  };
  it("restores the previous view when closed and excludes the selection from persistence", () => {
    const opened = reduceWorkspacePanel(previous, {
      type: "open",
      kind: "code",
    });
    expect(opened).toMatchObject({
      tabs: ["changes", "code"],
      active: "code",
      open: true,
      expanded: false,
    });
    expect(
      reduceWorkspacePanel(opened, { type: "expand", expanded: true }),
    ).toBe(opened);
    expect(
      reduceWorkspacePanel(opened, { type: "close", kind: "code" }),
    ).toEqual(previous);
    expect(persistentWorkspacePanel(opened)).toEqual(previous);
  });
  it("replaces a selection without losing the original return view", () => {
    const first = reduceWorkspacePanel(previous, {
      type: "open",
      kind: "code",
    });
    const second = reduceWorkspacePanel(first, {
      type: "open",
      kind: "pull-request",
    });
    expect(second.tabs).toEqual(["changes", "pull-request"]);
    expect(
      reduceWorkspacePanel(second, { type: "close", kind: "pull-request" }),
    ).toEqual(previous);
  });
  it("keeps the active persistent tab when an inactive selection closes", () => {
    const opened = reduceWorkspacePanel(previous, {
      type: "open",
      kind: "code",
    });
    const switched = reduceWorkspacePanel(opened, {
      type: "open",
      kind: "changes",
    });
    expect(
      reduceWorkspacePanel(switched, { type: "close", kind: "code" }),
    ).toMatchObject({ tabs: ["changes"], active: "changes", open: true });
  });
});
