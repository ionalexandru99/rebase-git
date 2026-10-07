import {
  IconCircleCheck,
  IconMinus,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import type { ChangeSection } from "#contracts/repository-changes/repository-changes.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
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
import { useStashMenu } from "#web/features/stashes/stashes.ts";
import type {
  ChangeAction,
  WorkingChangesView,
} from "#web/features/working-changes/hooks/use-working-changes-view.ts";

export type ChangeFileSectionView = Pick<
  WorkingChangesView,
  "changes" | "preferences" | "selection" | "select" | "busy" | "loading"
>;

export const changeSectionLooks: Record<ChangeSection, SectionLook> = {
  unstaged: {
    Icon: IconPencil,
    className: "text-amber-700 dark:text-amber-300",
  },
  staged: {
    Icon: IconCircleCheck,
    className: "text-emerald-600 dark:text-emerald-300",
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
  const { changes, preferences, selection, busy, loading } = view;
  const anchor = useRef<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
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
  const rowActions = (paths: readonly string[]): readonly Action[] => {
    const files = { _tag: "Files", paths } as const;
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
        enabled: !disabled,
        run: () => act(action, section, files),
      },
      stashMenu(
        stashable && !disabled
          ? { revision: changes.revision, section, paths }
          : undefined,
      ),
      ...fileHistory(
        paths.filter((path) =>
          changes?.[section].some(
            (file) =>
              file.path === path && file.status !== "?" && file.status !== "A",
          ),
        ),
      ),
      {
        id: "discard",
        label: "Discard",
        enabled: !disabled,
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
      menu={(row) =>
        rowActions(
          row.paths.length > 0 && row.paths.every((path) => checked.has(path))
            ? selected
            : row.paths,
        )
      }
      chosen={(row) =>
        checked.has(row.key) ||
        (selection?.section === section && selection.path === row.key)
      }
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
        return (
          <>
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none"
              aria-label={`${isFolder ? "Folder" : label} ${row.key}${previousPath ? ` renamed from ${previousPath}` : ""}`}
              aria-expanded={isFolder ? !collapsed.has(row.key) : undefined}
              aria-pressed={row.paths.every((path) => checked.has(path))}
              aria-current={
                selection?.section === section && selection.path === row.key
                  ? "true"
                  : undefined
              }
              aria-describedby={
                status !== undefined && status !== "U"
                  ? statusId(section, row.key)
                  : undefined
              }
              onContextMenu={() => {
                if (row.paths.every((path) => checked.has(path))) return;
                anchor.current = row.key;
                setChecked(new Set(row.paths));
              }}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) {
                  const start = rows.findIndex(
                    (entry) => entry.key === anchor.current,
                  );
                  const paths =
                    event.shiftKey && start >= 0
                      ? rows
                          .slice(
                            Math.min(start, index),
                            Math.max(start, index) + 1,
                          )
                          .flatMap((entry) => (entry.file ? entry.paths : []))
                      : row.paths;
                  setChecked((current) => {
                    const next = event.shiftKey
                      ? new Set<string>()
                      : new Set(current);
                    const remove =
                      !event.shiftKey && paths.every((path) => next.has(path));
                    for (const path of paths) {
                      if (remove) next.delete(path);
                      else next.add(path);
                    }
                    return next;
                  });
                  if (!event.shiftKey) anchor.current = row.key;
                  return;
                }
                anchor.current = row.key;
                setChecked(new Set(isFolder ? [] : row.paths));
                isFolder
                  ? toggle(row.key)
                  : view.select({ section, path: row.key });
              }}
            >
              <RowLead row={row} collapsed={collapsed} />
              <FileRowName
                row={row}
                tree={preferences.tree}
                statusId={statusId(section, row.key)}
              />
            </button>
            {row.file ? (
              <span className="relative flex shrink-0 items-center justify-end">
                <LineCounts
                  lines={row.file.lines}
                  className="transition-opacity group-has-[:focus-visible]:opacity-0 group-hover:opacity-0"
                />
                <span className="absolute right-0 flex items-center opacity-0 group-has-[:focus-visible]:opacity-100 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Discard ${label.toLowerCase()} ${row.key}`}
                    disabled={disabled}
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
                    disabled={disabled}
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
