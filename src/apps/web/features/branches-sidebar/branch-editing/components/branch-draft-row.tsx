import type { LocalBranch } from "@rebase/contracts";
import type { BranchStartPoint } from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import { BranchNameField } from "#web/features/branches-sidebar/branch-editing/components/branch-name-field";

export function BranchDraftRow({
  branches,
  onCancel,
  onCreate,
  startPoint,
}: {
  readonly branches: readonly Pick<LocalBranch, "name">[];
  readonly onCancel: () => void;
  readonly onCreate: (name: string) => Promise<string | undefined>;
  readonly startPoint: BranchStartPoint;
}) {
  return (
    <div className="px-1.5 py-1">
      <BranchNameField
        branches={branches}
        initialName={startPoint.name}
        label={`New branch from ${startPoint.label}`}
        onCancel={onCancel}
        onSubmit={onCreate}
      />
    </div>
  );
}
