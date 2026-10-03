import {
  IconCircleCheck,
  IconMinus,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import type {
  ChangedFile,
  ChangeSection,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { useStashMenu } from "#web/features/stashes/stashes.ts";
import {
  FileListSection,
  RowLead,
  type SectionLook,
} from "#web/features/working-changes/components/file-list-section.tsx";
import type {
  ChangeAction,
  WorkingChangesView,
} from "#web/features/working-changes/hooks/use-working-changes-view.ts";
import { compactCount } from "#web/lib/compact-count.ts";
import { cn } from "#web/lib/utils.ts";

export type ChangeFileSectionView = Pick<
  WorkingChangesView,
  "changes" | "preferences" | "selection" | "select" | "busy" | "loading"
>;

const looks: Record<ChangeSection, SectionLook> = {
  unstaged: { Icon: IconPencil, className: "text-amber-300" },
  staged: { Icon: IconCircleCheck, className: "text-emerald-300" },
};

const statusTones: Partial<Record<ChangedFile["status"], string>> = {
  A: "text-emerald-300",
  "?": "text-emerald-300",
  D: "text-rose-300 line-through decoration-rose-300/60",
  R: "text-sky-300",
};

const statusLabels: Record<Exclude<ChangedFile["status"], "U">, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  T: "Type changed",
  "?": "Untracked",
};

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
      {
        id: "discard",
        label: "Discard…",
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
      look={looks[section]}
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
            className="shrink-0 px-3 py-1.5 text-xs text-muted-foreground"
          >
            Renames not detected: too many changed files.
          </p>
        ) : null
      }
      footer={(open) =>
        open && selected.length > 1 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-border border-t p-1.5">
            <span className="mr-auto text-xs text-muted-foreground">
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
        const tone = status === undefined ? undefined : statusTones[status];
        return (
          <>
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none"
              aria-label={`${isFolder ? "Folder" : label} ${row.key}${previousPath ? ` renamed from ${previousPath}` : ""}`}
              aria-expanded={isFolder ? !collapsed.has(row.key) : undefined}
              aria-pressed={row.paths.every((path) => checked.has(path))}
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
              {isFolder ? (
                <span className="min-w-0 truncate text-[.81rem]">
                  {row.name}/
                </span>
              ) : preferences.tree ? (
                <>
                  <span className={cn("min-w-0 truncate", tone)}>
                    {row.name}
                  </span>
                  {previousPath ? (
                    <span className="min-w-0 shrink-[100] truncate text-[11px] text-muted-foreground">
                      ← {renameHint(previousPath, row.key)}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className={cn("truncate", tone)}>
                    {fileName(row.key)}
                  </span>
                  <span
                    className="truncate text-[11px] text-muted-foreground"
                    style={{ direction: "rtl", textAlign: "left" }}
                  >
                    <bdi>
                      {previousPath
                        ? `← ${renameHint(previousPath, row.key)} · `
                        : ""}
                      {folderOf(row.key)}
                    </bdi>
                  </span>
                </span>
              )}
              {status !== undefined && status !== "U" ? (
                <span className="sr-only">{statusLabels[status]}</span>
              ) : null}
            </button>
            {row.file ? (
              <span className="relative flex shrink-0 items-center justify-end">
                <LineCounts lines={row.file.lines} />
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

function LineCounts({ lines }: { readonly lines: ChangedFile["lines"] }) {
  return (
    <span className="flex min-w-14 justify-end gap-1 pr-1 font-mono text-[11px] tabular-nums transition-opacity group-has-[:focus-visible]:opacity-0 group-hover:opacity-0">
      {lines && lines.added > 0 ? (
        <span className="text-emerald-400">+{compactCount(lines.added)}</span>
      ) : null}
      {lines && lines.removed > 0 ? (
        <span className="text-rose-400">−{compactCount(lines.removed)}</span>
      ) : null}
    </span>
  );
}

function fileName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function folderOf(path: string) {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function renameHint(previousPath: string, path: string) {
  const { prefix, before, suffix } = renameParts(previousPath, path);
  if (suffix.length === 0) return before.join("/");
  const folder = before.length > 0 ? before : prefix.slice(-1);
  return `${folder.join("/")}/`;
}

function renameParts(previousPath: string, path: string) {
  const from = previousPath.split("/");
  const to = path.split("/");
  let start = 0;
  while (
    start < from.length - 1 &&
    start < to.length - 1 &&
    from[start] === to[start]
  )
    start++;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from.at(-1 - end) === to.at(-1 - end)
  )
    end++;
  return {
    prefix: from.slice(0, start),
    before: from.slice(start, from.length - end),
    after: to.slice(start, to.length - end),
    suffix: from.slice(from.length - end),
  };
}
