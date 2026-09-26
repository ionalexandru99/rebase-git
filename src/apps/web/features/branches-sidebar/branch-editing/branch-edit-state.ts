import type { LocalBranch } from "@rebase/contracts";
import type { BranchStartPoint } from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import {
  type BranchesSidebarRow,
  localBranchesSectionId,
} from "#web/features/branches-sidebar/branches-sidebar-model";

export type BranchEdit =
  | { readonly kind: "create"; readonly startPoint: BranchStartPoint }
  | {
      readonly branch: LocalBranch;
      readonly kind: "rename" | "upstream";
      readonly rowId: string;
    };

export type BranchesSidebarItem =
  | {
      readonly id: string;
      readonly kind: "row";
      readonly row: BranchesSidebarRow;
    }
  | { readonly id: "branch-draft"; readonly kind: "draft" };

export function branchesSidebarItems(
  rows: readonly BranchesSidebarRow[],
  edit: BranchEdit | undefined,
): readonly BranchesSidebarItem[] {
  const items: BranchesSidebarItem[] = rows.map((row) => ({
    id: row.id,
    kind: "row",
    row,
  }));
  if (edit?.kind === "create") {
    const local = rows.findIndex(
      (row) =>
        row.kind === "section" && row.sectionId === localBranchesSectionId,
    );
    items.splice(local + 1, 0, { id: "branch-draft", kind: "draft" });
  }
  return items;
}

export function estimateItemHeight(item: BranchesSidebarItem | undefined) {
  if (item?.kind === "draft") return 40;
  return item?.row.kind === "section" && item.row.separator ? 44 : 32;
}

export function isBranchEditItem(
  item: BranchesSidebarItem,
  edit: BranchEdit | undefined,
) {
  return (
    item.kind !== "row" || (edit?.kind === "rename" && edit.rowId === item.id)
  );
}

export function localBranchRowId(name: string) {
  return `ref:${localBranchesSectionId}:${name}`;
}

export function localBranchFolderIds(name: string): readonly string[] {
  const parts = name.split("/").slice(0, -1);
  return parts.map(
    (_, index) =>
      `folder:${localBranchesSectionId}:${parts.slice(0, index + 1).join("/")}`,
  );
}
