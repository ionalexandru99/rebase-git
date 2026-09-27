import type { ConflictFile, ConflictSides } from "@rebase/contracts";
import { IconArrowDown } from "@tabler/icons-react";
import { Button } from "#web/components/ui/button";
import {
  FileListSection,
  RowLead,
} from "#web/features/working-changes/components/file-list-section";
import { MarkersConfirmation } from "#web/features/working-changes/conflicts/components/markers-confirmation";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view";

export type ConflictFileSectionView = Pick<
  WorkingChangesView,
  "conflicts" | "preferences" | "selection" | "select" | "busy" | "loading"
>;

export function ConflictFileSection({
  view,
  filter,
  writable,
}: {
  readonly view: ConflictFileSectionView;
  readonly filter: string;
  readonly writable: boolean;
}) {
  const { conflicts, selection } = view;
  if (conflicts.rows.length === 0) return null;
  const disabled = !writable || view.busy || view.loading;
  const chosen = (path: string) =>
    selection?.section === "conflicts" && selection.path === path;
  return (
    <FileListSection
      name="Conflicted files"
      title="Conflicts"
      countClassName="text-status-connecting"
      files={conflicts.rows}
      tree={view.preferences.tree}
      filter={filter}
      emptyLabel="No matching files"
      chosen={(row) => chosen(row.key)}
    >
      {(row, { collapsed, toggle }) => {
        const conflict = row.file;
        if (conflict === undefined)
          return (
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
              aria-label={`Folder ${row.key}`}
              aria-expanded={!collapsed.has(row.key)}
              onClick={() => toggle(row.key)}
            >
              <RowLead row={row} collapsed={collapsed} />
              <span className="truncate">{row.name}</span>
            </button>
          );
        const { path, file } = conflict;
        return (
          <>
            <button
              type="button"
              className="flex min-w-20 flex-1 items-center gap-1.5 text-left text-xs"
              aria-label={`Conflict ${path}`}
              aria-pressed={chosen(path)}
              onClick={() => view.select({ section: "conflicts", path })}
            >
              <RowLead row={row} collapsed={collapsed} />
              <span className="truncate">{row.name}</span>
            </button>
            {conflicts.confirming === path ? (
              <MarkersConfirmation
                path={path}
                disabled={disabled}
                cancel={conflicts.cancel}
                confirm={() => conflicts.resolve(path, true)}
              />
            ) : (
              <>
                {file ? (
                  <span className="min-w-0 max-w-[45%] truncate text-[10px] text-muted-foreground">
                    {conflictLabel(file, conflicts.sides)}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Mark ${path} resolved`}
                  disabled={disabled || file === undefined}
                  onClick={() => conflicts.resolve(path, false)}
                >
                  <IconArrowDown />
                </Button>
                <span className="size-7 shrink-0 sm:size-6" />
              </>
            )}
          </>
        );
      }}
    </FileListSection>
  );
}

function conflictLabel(file: ConflictFile, sides: ConflictSides | undefined) {
  if (file.openRegions > 0) return `${file.openRegions} open`;
  if (file.stages.some((stage) => stage.binary)) return "binary";
  const side = (name: "current" | "incoming") =>
    sides?.[name].ref ?? sides?.[name].commit?.slice(0, 8) ?? name;
  switch (file.kind) {
    case "both-modified":
      return "both changed";
    case "both-added":
      return "both added";
    case "both-deleted":
      return "both deleted";
    case "deleted-in-current":
      return `deleted in ${side("current")}`;
    case "deleted-in-incoming":
      return `deleted in ${side("incoming")}`;
    case "added-in-current":
      return `added in ${side("current")}`;
    case "added-in-incoming":
      return `added in ${side("incoming")}`;
  }
}
