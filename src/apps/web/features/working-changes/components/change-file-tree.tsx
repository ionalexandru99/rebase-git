import { useState } from "react";
import { FileListToolbar } from "#web/features/file-diff/components/file-list-toolbar.tsx";
import {
  ChangeFileSection,
  type ChangeFileSectionView,
} from "#web/features/working-changes/components/change-file-section.tsx";
import {
  ConflictFileSection,
  type ConflictFileSectionView,
} from "#web/features/working-changes/conflicts/components/conflict-file-section.tsx";
import type {
  ChangeAction,
  WorkingChangesView,
} from "#web/features/working-changes/hooks/use-working-changes-view.ts";

type FileTreeView = ChangeFileSectionView &
  ConflictFileSectionView &
  Pick<WorkingChangesView, "choosePreferences">;

export function ChangeFileTree({
  view,
  writable,
  act,
}: {
  readonly view: FileTreeView;
  readonly writable: boolean;
  readonly act: ChangeAction;
}) {
  const { preferences } = view;
  const [filter, setFilter] = useState("");
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-sidebar"
      aria-label="Changed files"
    >
      <FileListToolbar
        filter={filter}
        onFilter={setFilter}
        tree={preferences.tree}
        onTree={(tree) => view.choosePreferences({ ...preferences, tree })}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 pb-1">
        <div className="flex min-h-[40%] flex-1 basis-0 flex-col">
          <ConflictFileSection
            view={view}
            filter={filter}
            writable={writable}
          />
          <ChangeFileSection
            view={view}
            section="unstaged"
            filter={filter}
            writable={writable}
            act={act}
          />
        </div>
        <div className="flex max-h-[55%] min-h-0 shrink-0 flex-col">
          <ChangeFileSection
            view={view}
            section="staged"
            filter={filter}
            writable={writable}
            act={act}
          />
        </div>
      </div>
    </section>
  );
}
