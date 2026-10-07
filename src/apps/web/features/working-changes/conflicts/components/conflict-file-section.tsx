import { IconAlertTriangle, IconArrowDown } from "@tabler/icons-react";
import type {
  ConflictFile,
  ConflictSides,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import {
  FileListSection,
  RowLead,
} from "#web/features/file-diff/components/file-list-section.tsx";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view.ts";

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
      look={{
        Icon: IconAlertTriangle,
        className: "text-destructive",
      }}
      grow
      files={conflicts.rows}
      tree={view.preferences.tree}
      filter={filter}
      chosen={(row) => chosen(row.key)}
    >
      {(row, { collapsed, toggle }) => {
        const conflict = row.file;
        if (conflict === undefined)
          return (
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none"
              aria-label={`Folder ${row.key}`}
              aria-expanded={!collapsed.has(row.key)}
              onClick={() => toggle(row.key)}
            >
              <RowLead row={row} collapsed={collapsed} />
              <span className="truncate text-body">{row.name}/</span>
            </button>
          );
        const { path, file } = conflict;
        return (
          <>
            <button
              type="button"
              className="flex h-full min-w-20 flex-1 items-center gap-2 text-left outline-none"
              aria-label={`Conflict ${path}`}
              aria-pressed={chosen(path)}
              onClick={() => view.select({ section: "conflicts", path })}
            >
              <RowLead row={row} collapsed={collapsed} />
              <span className="truncate">{row.name}</span>
            </button>
            {conflicts.confirming === path ? (
              <Confirmation
                title="Conflict markers remain"
                action="Mark resolved anyway"
                busy={view.busy}
                disabled={disabled}
                onCancel={conflicts.cancel}
                onConfirm={() => void conflicts.resolve(path, true)}
                className="min-w-0 flex-nowrap"
              />
            ) : (
              <>
                {file ? (
                  <span className="min-w-0 max-w-[45%] truncate text-badge text-muted-foreground">
                    {conflictLabel(file, conflicts.sides)}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Mark ${path} resolved`}
                  disabled={disabled || file === undefined}
                  onClick={() => void conflicts.resolve(path, false)}
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
