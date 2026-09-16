import { describe, expect, it } from "vitest";
import {
  workspacePanelDefinitions,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel-definitions";
import {
  initialWorkspacePanelState,
  reduceWorkspacePanel,
} from "#web/features/workspace-panel/workspace-panel-state";

describe("workspace panel state", () => {
  it("does not open unavailable features", () => {
    for (const kind of workspacePanelKinds) {
      if (workspacePanelDefinitions[kind].available) continue;
      expect(
        reduceWorkspacePanel(initialWorkspacePanelState, {
          type: "open",
          kind,
        }),
      ).toBe(initialWorkspacePanelState);
    }
  });

  it("preserves the panel width while hiding and showing it", () => {
    const resized = reduceWorkspacePanel(initialWorkspacePanelState, {
      type: "resize",
      width: 55,
    });
    const hidden = reduceWorkspacePanel(resized, {
      type: "visibility",
      open: false,
    });
    expect(hidden).toMatchObject({ open: false, width: 55 });
    expect(
      reduceWorkspacePanel(hidden, { type: "visibility", open: true }),
    ).toEqual({ ...resized, open: true });
  });
});
