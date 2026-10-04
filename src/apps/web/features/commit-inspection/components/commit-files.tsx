import { IconFileDiff } from "@tabler/icons-react";
import { type MouseEvent, type ReactNode, useRef, useState } from "react";
import type { CommitFile } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable.tsx";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";
import {
  FileListSection,
  openMenu,
  RowLead,
} from "#web/features/file-diff/components/file-list-section.tsx";
import { FileListToolbar } from "#web/features/file-diff/components/file-list-toolbar.tsx";
import {
  FileRowName,
  LineCounts,
} from "#web/features/file-diff/components/file-row-name.tsx";
import type { ChangeTreeRow } from "#web/features/file-diff/file-tree.ts";

export function CommitFiles({
  files,
  path,
  select,
  preferences,
  choosePreferences,
  actionsFor,
  onMenuClose,
  children,
}: {
  readonly files: readonly CommitFile[];
  readonly path: string | null;
  readonly select: (path: string) => void;
  readonly preferences: DiffPreferences;
  readonly choosePreferences: (preferences: DiffPreferences) => void;
  readonly actionsFor?:
    | ((paths: readonly string[], anchor: string) => readonly Action[])
    | undefined;
  readonly onMenuClose?: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const [marked, setMarked] = useState<{
    readonly files: readonly CommitFile[];
    readonly paths: ReadonlySet<string>;
  }>({ files, paths: new Set() });
  const checked = marked.files === files ? marked.paths : new Set<string>();
  const setChecked = (paths: ReadonlySet<string>) =>
    setMarked({ files, paths });
  const anchor = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected: ReadonlySet<string> =
    path !== null && checked.has(path)
      ? checked
      : new Set(path === null ? [] : [path]);
  const tree = preferences.tree;

  const click = (
    event: MouseEvent<HTMLButtonElement>,
    row: ChangeTreeRow<CommitFile>,
    rows: readonly ChangeTreeRow<CommitFile>[],
    index: number,
    toggle: (key: string) => void,
  ) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      const start = rows.findIndex(
        (entry) => entry.key === (anchor.current ?? path),
      );
      const paths =
        event.shiftKey && start >= 0
          ? rows
              .slice(Math.min(start, index), Math.max(start, index) + 1)
              .flatMap((entry) => (entry.file ? entry.paths : []))
          : row.paths;
      const next = new Set(event.shiftKey ? [] : selected);
      const remove = !event.shiftKey && paths.every((entry) => next.has(entry));
      for (const entry of paths) {
        if (remove) next.delete(entry);
        else next.add(entry);
      }
      if (!event.shiftKey) anchor.current = row.key;
      setChecked(next);
      const [first] = next;
      if (path !== null && !next.has(path) && first !== undefined)
        select(first);
      return;
    }
    anchor.current = row.key;
    if (row.file === undefined) {
      toggle(row.key);
      return;
    }
    setChecked(new Set([row.file.path]));
    select(row.file.path);
  };

  const menuPaths = (row: ChangeTreeRow<CommitFile>) =>
    row.paths.every((entry) => selected.has(entry)) ? [...selected] : row.paths;

  const pick = (row: ChangeTreeRow<CommitFile>) => {
    const target = menuTarget(row);
    if (target === undefined || actionsFor === undefined) return;
    if (!row.paths.every((entry) => selected.has(entry))) {
      anchor.current = row.key;
      setChecked(new Set(row.paths));
    }
    select(target);
  };

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel id="commit-diff" defaultSize="70%" minSize="12rem">
        {children}
      </ResizablePanel>
      <ResizableHandle aria-label="Resize changed-file tree" />
      <ResizablePanel
        id="commit-files"
        defaultSize="21rem"
        groupResizeBehavior="preserve-pixel-size"
        minSize="12.5rem"
        maxSize="26rem"
      >
        <div
          className="flex h-full min-h-0 flex-col border-border border-l bg-sidebar pb-1"
          ref={list}
        >
          <FileListToolbar
            filter={filter}
            onFilter={setFilter}
            tree={tree}
            onTree={(next) => choosePreferences({ ...preferences, tree: next })}
            region={list}
          />
          <FileListSection
            name="Changed files"
            title="Changed files"
            look={{ Icon: IconFileDiff, className: "text-sidebar-foreground" }}
            grow
            files={files}
            tree={tree}
            filter={filter}
            chosen={(row) => row.file !== undefined && selected.has(row.key)}
            menu={
              actionsFor &&
              ((row) => {
                const target = menuTarget(row);
                return target === undefined
                  ? []
                  : actionsFor(menuPaths(row), target);
              })
            }
            onMenuClose={onMenuClose}
            onMenuOpen={pick}
          >
            {(row, { rows, index, collapsed, toggle }) => {
              const file = row.file;
              const statusId = `commit-status-${encodeURIComponent(row.key)}`;
              return (
                <>
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 text-left outline-none"
                    aria-label={
                      file
                        ? `${file.path}${file.previousPath ? ` renamed from ${file.previousPath}` : ""}`
                        : `Folder ${row.key}`
                    }
                    aria-pressed={file ? selected.has(file.path) : undefined}
                    aria-expanded={file ? undefined : !collapsed.has(row.key)}
                    aria-describedby={file ? statusId : undefined}
                    onClick={(event) => click(event, row, rows, index, toggle)}
                    onKeyDown={openMenu}
                  >
                    <RowLead row={row} collapsed={collapsed} />
                    <FileRowName row={row} tree={tree} statusId={statusId} />
                  </button>
                  {file ? <LineCounts lines={file.lines} /> : null}
                </>
              );
            }}
          </FileListSection>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function menuTarget(row: ChangeTreeRow<CommitFile>) {
  return row.file?.path ?? row.paths[0];
}
