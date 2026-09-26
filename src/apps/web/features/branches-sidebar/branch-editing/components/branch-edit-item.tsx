import type { LocalBranch } from "@rebase/contracts";
import { branchNameProblem } from "#web/features/branch-management/branch-name";
import type { BranchesSidebarItem } from "#web/features/branches-sidebar/branch-editing/branch-edit-state";
import type { BranchEditing } from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-editing";
import { RefNameField } from "#web/features/branches-sidebar/components/ref-name-field";

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
      <div className="px-1.5 py-1">
        <RefNameField
          initialName={edit.startPoint.name}
          label={`New branch from ${edit.startPoint.label}`}
          onCancel={editing.cancel}
          onSubmit={editing.createBranch}
          problem={(name) => branchNameProblem(name, branches)}
        />
      </div>
    );
  if (item.kind !== "row" || edit?.kind !== "rename") return null;
  return (
    <div
      className="py-0.5"
      style={{ paddingLeft: 4 + Math.max(0, item.row.level - 2) * 18 }}
    >
      <RefNameField
        initialName={edit.branch.name}
        label={`Rename ${edit.branch.name}`}
        onCancel={editing.cancel}
        onSubmit={editing.renameBranch}
        problem={(name) => branchNameProblem(name, branches, edit.branch.name)}
      />
    </div>
  );
}
