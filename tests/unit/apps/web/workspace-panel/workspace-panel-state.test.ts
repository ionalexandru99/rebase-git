import { describe, expect, it } from "vite-plus/test";
import {
  initialWorkspacePanelState,
  reduceWorkspacePanel,
} from "#web/features/workspace-panel/workspace-panel-state.ts";

describe("workspace panel state", () => {
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
