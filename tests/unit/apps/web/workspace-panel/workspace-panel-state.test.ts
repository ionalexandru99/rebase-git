import { describe, expect, it } from "vite-plus/test";
import type { WorkspacePanelState } from "#web/features/workspace-panel/workspace-panel-model.ts";
import {
  fitWorkspace,
  initialWorkspacePanelState,
  reduceWorkspacePanel,
} from "#web/features/workspace-panel/workspace-panel-state.ts";

describe("workspace panel state", () => {
  it("keeps sidebar and panel widths while the window leaves the graph room", () => {
    const widths = { sidebar: 16, panel: 36 };
    expect(fitWorkspace({ width: 1661, rem: 16, widths, open: true })).toEqual({
      sidebar: 256,
      panel: 576,
    });
    expect(fitWorkspace({ width: 2301, rem: 16, widths, open: false })).toEqual(
      { sidebar: 256, panel: 0 },
    );
  });

  it("shrinks the sidebar before the panel to keep the graph readable", () => {
    const widths = { sidebar: 16, panel: 36 };
    expect(fitWorkspace({ width: 1181, rem: 16, widths, open: true })).toEqual({
      sidebar: 192,
      panel: 413,
    });
    expect(fitWorkspace({ width: 1021, rem: 16, widths, open: true })).toEqual({
      sidebar: 192,
      panel: 320,
    });
  });

  it("preserves the panel width while hiding and showing it", () => {
    const resized = reduceWorkspacePanel(initialWorkspacePanelState, {
      type: "resize",
      widths: { sidebar: 18, panel: 40 },
    });
    const hidden = reduceWorkspacePanel(resized, {
      type: "visibility",
      open: false,
    });
    expect(hidden).toMatchObject({
      open: false,
      widths: { sidebar: 18, panel: 40 },
    });
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

  it("changes a compare tab's sides in place and merges into a tab that already shows the result", () => {
    const branch = (name: string) => ({ _tag: "LocalBranch", name }) as const;
    const compare = (from: string, to: string) =>
      ({ _tag: "Compare", from: branch(from), to: branch(to) }) as const;
    const opened = [compare("main", "a"), compare("main", "b")].reduce(
      (state, input) =>
        reduceWorkspacePanel(state, { type: "open", kind: "compare", input }),
      reduceWorkspacePanel(initialWorkspacePanelState, {
        type: "open",
        kind: "commit",
      }),
    );

    const swapped = reduceWorkspacePanel(opened, {
      type: "replace",
      kind: "compare",
      previous: compare("main", "a"),
      input: compare("a", "main"),
    });
    const merged = reduceWorkspacePanel(swapped, {
      type: "replace",
      kind: "compare",
      previous: compare("a", "main"),
      input: compare("main", "b"),
    });

    expect(swapped.tabs).toEqual([
      "commit",
      "compare:LocalBranch/a...LocalBranch/main",
      "compare:LocalBranch/main...LocalBranch/b",
    ]);
    expect(
      swapped.inputs?.["compare:LocalBranch/a...LocalBranch/main"],
    ).toEqual(compare("a", "main"));
    expect(merged).toMatchObject({
      tabs: ["commit", "compare:LocalBranch/main...LocalBranch/b"],
      active: "compare:LocalBranch/main...LocalBranch/b",
    });
  });
});
