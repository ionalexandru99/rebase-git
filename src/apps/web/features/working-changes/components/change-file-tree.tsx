import { useRef, useState } from "react";
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
  Pick<WorkingChangesView, "choosePreferences" | "discardNotice">;

const undoKeys = navigator.platform.startsWith("Mac") ? "⌘Z" : "Ctrl+Z";

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
  const list = useRef<HTMLElement>(null);
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-sidebar"
      aria-label="Changed files"
      ref={list}
    >
      <FileListToolbar
        filter={filter}
        onFilter={setFilter}
        tree={preferences.tree}
        onTree={(tree) => {
          view.choosePreferences({ ...preferences, tree });
          if (!tree && view.selection !== null && "folder" in view.selection)
            view.select(null);
        }}
        region={list}
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
      {view.discardNotice === null ? null : (
        <p
          role="status"
          className="mx-2 mb-2 shrink-0 rounded-control border border-border bg-muted/40 px-2 py-1.5 text-meta text-muted-foreground"
        >
          {view.discardNotice.title},{" "}
          <button
            type="button"
            aria-keyshortcuts="Control+Z Meta+Z"
            className="rounded-control font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={view.discardNotice.undo}
          >
            {undoKeys} to undo
          </button>
        </p>
      )}
    </section>
  );
}
