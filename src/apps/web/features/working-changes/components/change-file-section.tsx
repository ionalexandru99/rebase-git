import {
  IconCircleCheck,
  IconMinus,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import type { ChangeSection } from "#contracts/repository-changes/repository-changes.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { useBlameAction } from "#web/features/file-blame/file-blame.ts";
import {
  FileListSection,
  RowLead,
  type SectionLook,
} from "#web/features/file-diff/components/file-list-section.tsx";
import {
  FileRowName,
  LineCounts,
} from "#web/features/file-diff/components/file-row-name.tsx";
import { useFileHistoryAction } from "#web/features/file-history/file-history.ts";
import {
  LockMark,
  missingReason,
  useLargeFiles,
} from "#web/features/large-files/large-files.tsx";
import { useStashMenu } from "#web/features/stashes/stashes.ts";
import { useChangeRowSelection } from "#web/features/working-changes/hooks/use-change-row-selection.ts";
import type {
  ChangeAction,
  WorkingChangesView,
} from "#web/features/working-changes/hooks/use-working-changes-view.ts";

export type ChangeFileSectionView = Pick<
  WorkingChangesView,
  | "changes"
  | "preferences"
  | "selection"
  | "select"
  | "busy"
  | "loading"
  | "ignore"
>;

export const changeSectionLooks: Record<ChangeSection, SectionLook> = {
  unstaged: {
    Icon: IconPencil,
    className: "text-warning",
  },
  staged: {
    Icon: IconCircleCheck,
    className: "text-success",
  },
};

export function ChangeCount({
  section,
  count,
}: {
  readonly section: ChangeSection;
  readonly count: number;
}) {
  if (count === 0) return null;
  const { Icon, className } = changeSectionLooks[section];
  return (
    <span className={`flex items-center gap-0.5 tabular-nums ${className}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {count}
    </span>
  );
}

export function ChangeFileSection({
  view,
  section,
  filter,
  writable,
  act,
}: {
  readonly view: ChangeFileSectionView;
  readonly section: ChangeSection;
  readonly filter: string;
  readonly writable: boolean;
  readonly act: ChangeAction;
}) {
  const { changes, preferences, busy, loading } = view;
  const rowSelection = useChangeRowSelection(view, section);
  const { checked } = rowSelection;
  const files = changes?.[section] ?? [];
  const selected = files
    .filter((file) => checked.has(file.path))
    .map((file) => file.path);
  const disabled = !writable || busy || loading;
  const label = section === "unstaged" ? "Unstaged" : "Staged";
  const action = section === "unstaged" ? "stage" : "unstage";
  const actionLabel = section === "unstaged" ? "Stage" : "Unstage";
  const ActionIcon = section === "unstaged" ? IconPlus : IconMinus;
  const stashMenu = useStashMenu();
  const fileHistory = useFileHistoryAction();
  const blame = useBlameAction();
  const committed = (paths: readonly string[]) =>
    paths.filter((path) =>
      changes?.[section].some(
        (file) =>
          file.path === path && file.status !== "?" && file.status !== "A",
      ),
    );
  const largeFiles = useLargeFiles(files);
  const lfsReason = (paths: readonly string[]) =>
    largeFiles.blocked(paths) ? { reason: missingReason } : {};
  const rowActions = (
    paths: readonly string[],
    ignored: readonly string[],
  ): readonly Action[] => {
    const files = { _tag: "Files", paths } as const;
    const blocked = largeFiles.blocked(paths);
    const stashable =
      changes !== undefined &&
      paths.every((path) =>
        changes[section].some(
          (file) => file.path === path && file.status !== "U",
        ),
      );
    return [
      {
        id: action,
        label: actionLabel,
        enabled: !disabled && (action === "unstage" || !blocked),
        ...(action === "stage" ? lfsReason(paths) : {}),
        run: () => act(action, section, files),
      },
      stashMenu(
        stashable && !disabled
          ? { revision: changes.revision, section, paths }
          : undefined,
      ),
      ...fileHistory(committed(paths)),
      ...blame(
        committed(paths).filter((path) =>
          changes?.[section].some(
            (file) => file.path === path && file.status !== "D",
          ),
        ),
        null,
      ),
      view.ignore.actionFor(ignored, !disabled),
      ...largeFiles.actions(paths),
      {
        id: "discard",
        label: "Discard",
        enabled: !disabled && !blocked,
        ...lfsReason(paths),
        group: "delete",
        run: () => act("discard", section, files),
      },
    ];
  };
  return (
    <FileListSection
      name={`${label} files`}
      title={label}
      look={changeSectionLooks[section]}
      grow={section === "unstaged"}
      files={files}
      tree={preferences.tree}
      filter={filter}
      menu={(row) => {
        if (row.file === undefined) return rowActions(row.paths, [row.key]);
        const paths = row.paths.every((path) => checked.has(path))
          ? selected
          : row.paths;
        return rowActions(paths, paths);
      }}
      chosen={rowSelection.chosen}
      folder={rowSelection.folder}
      headerMenu={[
        {
          id: `${action}-all`,
          label: `${actionLabel} all`,
          enabled: !disabled && files.length > 0,
          run: () => act(action, section, { _tag: "All" }),
        },
      ]}
      notice={
        section === "staged" && changes?.renamesLimited ? (
          <p
            role="status"
            className="shrink-0 px-3 py-1.5 text-meta text-muted-foreground"
          >
            Renames not detected: too many changed files.
          </p>
        ) : null
      }
      footer={(open) =>
        open && selected.length > 1 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-border border-t p-1.5">
            <span className="mr-auto text-meta text-muted-foreground">
              {selected.length} selected
            </span>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                act("discard", section, { _tag: "Files", paths: selected })
              }
            >
              Discard
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                act(action, section, { _tag: "Files", paths: selected })
              }
            >
              {actionLabel}
            </Button>
          </div>
        ) : null
      }
    >
      {(row, { rows, index, collapsed, toggle }) => {
        const isFolder = row.file === undefined;
        const previousPath = row.file?.previousPath ?? null;
        const status = row.file?.status;
        const held = row.file ? largeFiles.lockOf(row.key) : undefined;
        const blocked = largeFiles.blocked(row.paths);
        return (
          <>
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none"
              aria-label={`${isFolder ? "Folder" : label} ${row.key}${previousPath ? ` renamed from ${previousPath}` : ""}`}
              aria-expanded={isFolder ? !collapsed.has(row.key) : undefined}
              aria-pressed={rowSelection.pressed(row)}
              aria-current={rowSelection.current(row) ? "true" : undefined}
              aria-describedby={
                status !== undefined && status !== "U"
                  ? statusId(section, row.key)
                  : undefined
              }
              onContextMenu={() => rowSelection.menuOpened(row)}
              onKeyDown={(event) => {
                if (!isFolder) return;
                const closed = collapsed.has(row.key);
                if (
                  (event.key === "ArrowLeft" && !closed) ||
                  (event.key === "ArrowRight" && closed)
                ) {
                  event.preventDefault();
                  toggle(row.key);
                }
              }}
              onClick={(event) => rowSelection.click(row, event, rows, index)}
            >
              <RowLead
                row={row}
                collapsed={collapsed}
                onToggle={isFolder ? () => toggle(row.key) : undefined}
              />
              <FileRowName
                row={row}
                tree={preferences.tree}
                statusId={statusId(section, row.key)}
              />
            </button>
            {row.file ? (
              <span className="relative flex shrink-0 items-center justify-end">
                <span className="transition-opacity group-has-[:focus-visible]:opacity-0 group-hover:opacity-0">
                  {held === undefined ? (
                    <LineCounts lines={row.file.lines} />
                  ) : (
                    <LockMark lock={held} />
                  )}
                </span>
                <span className="absolute right-0 flex items-center opacity-0 group-has-[:focus-visible]:opacity-100 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Discard ${label.toLowerCase()} ${row.key}`}
                    disabled={disabled || blocked}
                    onClick={() =>
                      act("discard", section, {
                        _tag: "Files",
                        paths: row.paths,
                      })
                    }
                  >
                    <IconTrash />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${actionLabel} ${row.key}`}
                    disabled={disabled || (action === "stage" && blocked)}
                    onClick={() =>
                      act(action, section, { _tag: "Files", paths: row.paths })
                    }
                  >
                    <ActionIcon />
                  </Button>
                </span>
              </span>
            ) : null}
          </>
        );
      }}
    </FileListSection>
  );
}

function statusId(section: ChangeSection, path: string) {
  return `change-status-${section}-${encodeURIComponent(path)}`;
}
