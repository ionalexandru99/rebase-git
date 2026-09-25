import type { LocalBranch } from "@rebase/contracts";
import type { BranchesSidebarItem } from "#web/features/branches-sidebar/branch-editing/branch-edit-state";
import type { BranchEditing } from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-editing";
import { BranchDraftRow } from "#web-ui/features/branches-sidebar/branch-editing/components/branch-draft-row";
import { BranchNameField } from "#web-ui/features/branches-sidebar/branch-editing/components/branch-name-field";

export function BranchEditItem({
  branches,
  editing,
  item,
}: {
  readonly branches: readonly Pick<LocalBranch, "name">[];
  readonly editing: BranchEditing;
  readonly item: BranchesSidebarItem;
}) {
  const edit = editing.edit;
  if (item.kind === "draft" && edit?.kind === "create")
    return (
      <BranchDraftRow
        branches={branches}
        onCancel={editing.cancel}
        onCreate={editing.createBranch}
        startPoint={edit.startPoint}
      />
    );
  if (item.kind !== "row" || edit?.kind !== "rename") return null;
  return (
    <div
      className="py-0.5"
      style={{ paddingLeft: 4 + Math.max(0, item.row.level - 2) * 18 }}
    >
      <BranchNameField
        branches={branches}
        current={edit.branch.name}
        initialName={edit.branch.name}
        label={`Rename ${edit.branch.name}`}
        onCancel={editing.cancel}
        onSubmit={editing.renameBranch}
      />
    </div>
  );
}
