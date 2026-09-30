import {
  IconArrowDown,
  IconArrowUp,
  IconChevronsDown,
  IconChevronsUp,
  IconTrash,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import type {
  ChangedFile,
  ChangeSection,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  FileListSection,
  RowLead,
} from "#web/features/working-changes/components/file-list-section.tsx";
import type {
  ChangeAction,
  WorkingChangesView,
} from "#web/features/working-changes/hooks/use-working-changes-view.ts";

export type ChangeFileSectionView = Pick<
  WorkingChangesView,
  "changes" | "preferences" | "selection" | "select" | "busy" | "loading"
>;

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
  const Arrow = section === "unstaged" ? IconArrowDown : IconArrowUp;
  const AllArrow = section === "unstaged" ? IconChevronsDown : IconChevronsUp;
  return (
    <FileListSection
      name={`${label} files`}
      title={label}
      files={files}
      tree={preferences.tree}
      filter={filter}
      chosen={(row) =>
        checked.has(row.key) ||
        (selection?.section === section && selection.path === row.key)
      }
      action={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${actionLabel} all`}
          disabled={disabled || files.length === 0}
          onClick={() => act(action, section, { _tag: "All" })}
        >
          <AllArrow />
        </Button>
      }
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
        return (
          <>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
              aria-label={`${isFolder ? "Folder" : label} ${row.key}${previousPath ? ` renamed from ${previousPath}` : ""}`}
              aria-expanded={isFolder ? !collapsed.has(row.key) : undefined}
              aria-pressed={row.paths.every((path) => checked.has(path))}
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
              <span className="truncate">
                {previousPath && !preferences.tree
                  ? compactRename(previousPath, row.key)
                  : row.name}
              </span>
              {previousPath && preferences.tree ? (
                <span className="min-w-0 shrink-[100] truncate text-[11px] text-muted-foreground">
                  ← {renameHint(previousPath, row.key)}
                </span>
              ) : null}
            </button>
            {row.file && row.file.status !== "U" ? (
              <span
                role="img"
                className="shrink-0 text-[10px] text-muted-foreground"
                aria-label={statusLabels[row.file.status]}
              >
                {row.file.status === "?" ? "A" : row.file.status}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${actionLabel} ${row.key}`}
              disabled={disabled}
              onClick={() =>
                act(action, section, { _tag: "Files", paths: row.paths })
              }
            >
              <Arrow />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Discard ${label.toLowerCase()} ${row.key}`}
              className="opacity-0 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
              disabled={disabled}
              onClick={() =>
                act("discard", section, { _tag: "Files", paths: row.paths })
              }
            >
              <IconTrash />
            </Button>
          </>
        );
      }}
    </FileListSection>
  );
}

export function renameHint(previousPath: string, path: string) {
  const { prefix, before, suffix } = renameParts(previousPath, path);
  if (suffix.length === 0) return before.join("/");
  const folder = before.length > 0 ? before : prefix.slice(-1);
  return `${folder.join("/")}/`;
}

export function compactRename(previousPath: string, path: string) {
  const { prefix, before, after, suffix } = renameParts(previousPath, path);
  return [
    ...prefix,
    `{${before.join("/")} → ${after.join("/")}}`,
    ...suffix,
  ].join("/");
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
