import { describe, expect, it } from "vitest";
import {
  workspacePanelAvailability,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel.contract";
import {
  initialWorkspacePanelState,
  reduceWorkspacePanel,
} from "#web/features/workspace-panel/workspace-panel-state";

describe("workspace panel state", () => {
  it("does not open unavailable features", () => {
    for (const kind of workspacePanelKinds) {
      if (workspacePanelAvailability[kind]) continue;
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
