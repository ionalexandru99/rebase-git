import { describe, expect, it } from "vite-plus/test";
import type { WorkspacePanelState } from "#web/features/workspace-panel/workspace-panel-model.ts";
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

  it("opens one history tab per file and switches to the tab a file already has", () => {
    const open = (state: WorkspacePanelState, path: string) =>
      reduceWorkspacePanel(state, {
        type: "open",
        kind: "history",
        input: { _tag: "FileHistory", path },
      });
    const commit = reduceWorkspacePanel(initialWorkspacePanelState, {
      type: "open",
      kind: "commit",
    });

    const two = open(open(commit, "src/a.ts"), "src/b.ts");
    const again = open(two, "src/a.ts");
    const closed = reduceWorkspacePanel(again, {
      type: "close",
      tab: "history:src/a.ts",
    });

    expect(two.tabs).toEqual([
      "commit",
      "history:src/a.ts",
      "history:src/b.ts",
    ]);
    expect(again).toMatchObject({ tabs: two.tabs, active: "history:src/a.ts" });
    expect(closed.inputs).toEqual({
      "history:src/b.ts": { _tag: "FileHistory", path: "src/b.ts" },
    });
    expect(closed.active).toBe("history:src/b.ts");
  });
});
