import type {
  ChangeSection,
  ChangeSelection,
  MutateChanges,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import { useState } from "react";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";
import { ChangeFileSection } from "#web-ui/features/working-changes/components/change-file-section";
import { useWorkingChanges } from "#web-ui/features/working-changes/working-changes-provider";

export type ChangeAction = (
  action: MutateChanges["action"],
  section: ChangeSection,
  selection: ChangeSelection,
) => void;
export function ChangeFileTree({
  writable,
  act,
}: {
  readonly writable: boolean;
  readonly act: ChangeAction;
}) {
  const { state, controller } = useWorkingChanges();
  const [filter, setFilter] = useState("");
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-sidebar"
      aria-label="Changed files"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-border border-b px-3">
        <span className="text-xs font-semibold">Files</span>
        <div className="flex gap-1">
          <Button
            size="xs"
            variant="ghost"
            aria-pressed={state.preferences.tree}
            className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
            onClick={() =>
              controller.preferences({ ...state.preferences, tree: true })
            }
          >
            Tree
          </Button>
          <Button
            size="xs"
            variant="ghost"
            aria-pressed={!state.preferences.tree}
            className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
            onClick={() =>
              controller.preferences({ ...state.preferences, tree: false })
            }
          >
            List
          </Button>
        </div>
      </div>
      <div className="shrink-0 p-2">
        <Input
          aria-label="Filter changed files"
          placeholder="Filter files"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ChangeFileSection
          section="unstaged"
          filter={filter}
          writable={writable}
          act={act}
        />
        <ChangeFileSection
          section="staged"
          filter={filter}
          writable={writable}
          act={act}
        />
      </div>
      {state.changes?.truncated ? (
        <p role="status" className="p-2 text-xs text-muted-foreground">
          The file list is too large to display completely. All-file actions
          still include every changed file.
        </p>
      ) : null}
    </section>
  );
}
