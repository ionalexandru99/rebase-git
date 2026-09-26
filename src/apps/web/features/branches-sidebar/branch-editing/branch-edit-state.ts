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
  | { readonly id: "ref-draft"; readonly kind: "draft" };

export function branchesSidebarItems(
  rows: readonly BranchesSidebarRow[],
  draftSectionId: string | undefined,
): readonly BranchesSidebarItem[] {
  const items: BranchesSidebarItem[] = rows.map((row) => ({
    id: row.id,
    kind: "row",
    row,
  }));
  if (draftSectionId !== undefined)
    items.splice(draftPosition(rows, draftSectionId), 0, {
      id: "ref-draft",
      kind: "draft",
    });
  return items;
}

function draftPosition(rows: readonly BranchesSidebarRow[], sectionId: string) {
  return (
    afterSection(rows, sectionId) ??
    (sectionId === localBranchesSectionId ? 0 : rows.length)
  );
}

function afterSection(rows: readonly BranchesSidebarRow[], sectionId: string) {
  const index = rows.findIndex(
    (row) => row.kind === "section" && row.sectionId === sectionId,
  );
  return index < 0 ? undefined : index + 1;
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

export function refRowId(sectionId: string, name: string) {
  return `ref:${sectionId}:${name}`;
}

export function refFolderIds(
  sectionId: string,
  name: string,
): readonly string[] {
  const parts = name.split("/").slice(0, -1);
  return parts.map(
    (_, index) => `folder:${sectionId}:${parts.slice(0, index + 1).join("/")}`,
  );
}
