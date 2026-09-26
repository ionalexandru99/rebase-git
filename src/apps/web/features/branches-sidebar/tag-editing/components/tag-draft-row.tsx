import { RefNameField } from "#web/features/branches-sidebar/components/ref-name-field";
import type { TagEditing } from "#web/features/branches-sidebar/tag-editing/hooks/use-tag-editing";

export function TagDraftRow({ editing }: { readonly editing: TagEditing }) {
  if (editing.draftOid === undefined) return null;
  return (
    <div className="px-1.5 py-1">
      <RefNameField
        initialName=""
        label={`New tag at ${editing.draftOid.slice(0, 7)}`}
        onCancel={editing.cancel}
        onSubmit={editing.create}
        problem={editing.nameProblem}
      />
    </div>
  );
}
