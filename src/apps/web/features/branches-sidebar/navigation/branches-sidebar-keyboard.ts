import type { BranchesSidebarRow } from "#web/features/branches-sidebar/branches-sidebar.contract";
import { stepRow } from "#web/features/branches-sidebar/branches-sidebar-state";

type ExpandableRow = Exclude<BranchesSidebarRow, { kind: "ref" }>;

export function treeKeyAction(
  key: string,
  actions: {
    readonly activate: (row: BranchesSidebarRow) => void;
    readonly activeRow: BranchesSidebarRow | undefined;
    readonly clearQuery: () => void;
    readonly collapse: (row: ExpandableRow) => void;
    readonly expand: (row: ExpandableRow) => void;
    readonly hasQuery: boolean;
    readonly rows: readonly BranchesSidebarRow[];
    readonly setActive: (rowId: string | undefined) => void;
    readonly toggleHistoryRef: (
      row: Extract<BranchesSidebarRow, { kind: "ref" }>,
    ) => void;
  },
): boolean {
  const { activeRow, rows } = actions;
  switch (key) {
    case "ArrowDown":
      actions.setActive(stepRow(rows, activeRow?.id, 1));
      return true;
    case "ArrowUp":
      actions.setActive(stepRow(rows, activeRow?.id, -1));
      return true;
    case "Home":
      actions.setActive(rows[0]?.id);
      return true;
    case "End":
      actions.setActive(rows.at(-1)?.id);
      return true;
    case "ArrowRight": {
      if (activeRow === undefined || activeRow.kind === "ref") return false;
      if (!activeRow.expanded) actions.expand(activeRow);
      else {
        const child =
          rows[rows.findIndex((row) => row.id === activeRow.id) + 1];
        if (
          child !== undefined &&
          child.kind !== "section" &&
          child.parentId === activeRow.id
        )
          actions.setActive(child.id);
      }
      return true;
    }
    case "ArrowLeft":
      if (activeRow === undefined) return false;
      if (activeRow.kind !== "ref" && activeRow.expanded)
        actions.collapse(activeRow);
      else if (activeRow.kind !== "section")
        actions.setActive(activeRow.parentId);
      return true;
    case "Enter":
      if (activeRow === undefined) return false;
      actions.activate(activeRow);
      return true;
    case " ":
      if (activeRow === undefined) return false;
      if (activeRow.kind === "ref") actions.toggleHistoryRef(activeRow);
      else actions.activate(activeRow);
      return true;
    case "Escape":
      if (!actions.hasQuery) return false;
      actions.clearQuery();
      return true;
    default:
      return false;
  }
}
