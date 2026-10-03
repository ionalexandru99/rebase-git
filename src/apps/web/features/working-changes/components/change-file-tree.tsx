import { IconList, IconListTree, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { IconSwitch } from "#web/components/ui/icon-switch.tsx";
import { Input } from "#web/components/ui/input.tsx";
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

const viewOptions = [
  { value: "list", label: "List view", Icon: IconList },
  { value: "tree", label: "Tree view", Icon: IconListTree },
] as const;

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
      <div className="flex shrink-0 items-center gap-2 p-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter changed files"
            placeholder="Filter files"
            className="pl-9"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <IconSwitch
          label="File view"
          options={viewOptions}
          value={preferences.tree ? "tree" : "list"}
          onChange={(value) =>
            view.choosePreferences({ ...preferences, tree: value === "tree" })
          }
        />
      </div>
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
